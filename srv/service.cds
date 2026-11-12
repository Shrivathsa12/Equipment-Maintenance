using {EquipmentMantain as EM} from '../db/schema';

service EquipmentMaintenance {
    entity EquipmentLocations    as projection on EM.EquipmentLocations;

    entity Equipment             as projection on EM.Equipment;

    entity MaintenancePlans      as projection on EM.MaintenancePlans;

    entity MaintenanceRequests   as projection on EM.MaintenanceRequests;

    @cds.redirection.target
    entity WorkOrders            as projection on EM.WorkOrders;

    entity WorkOrderOperations   as projection on EM.WorkOrderOperations;

    entity Technicians           as projection on EM.Technicians;

    entity TechnicianAssignments as projection on EM.TechnicianAssignments;

    entity TimeConfirmations     as projection on EM.TimeConfirmations;

    entity SpareParts            as projection on EM.SpareParts;

    entity PartConsumptions      as projection on EM.PartConsumptions;

    @cds.redirection.target
    entity DowntimeEvents        as projection on EM.DowntimeEvents;

    entity EquipmentReadings     as projection on EM.EquipmentReadings;

    entity MaintenanceDocuments  as projection on EM.MaintenanceDocuments;

    // action
    action reportBreakdown(equipment: UUID,
                           symptom: String(255),
                           description: String(1000),
                           requestedPriority: EM.Priority,
                           safetyImpact: EM.ImpactLevel,
                           productionImpact: EM.ImpactLevel,
                           category: EM.RequestCategory,
                           reportedBy: String(255),
                           photos: many {
        fileName : String(255);
        mimeType : String(100);
        content  : LargeBinary;
    })                                                                              returns MaintenanceRequests;


    //action createPreventiveOrder(PlanID: UUID)                                      returns WorkOrders;
    
    action createPreventiveOrder(PlanID: UUID)                                      returns WorkOrders;

    action generateDuePreventiveOrders()                                            returns many WorkOrders;

    action assignTechnician(WorkOrderID: UUID, TechnicianID: UUID, isLead: Boolean) returns WorkOrders;

    action releaseOrder(WorkOrderID: UUID)                                          returns WorkOrders;

    action confirmOperation(WorkOrderID: UUID,
                            OperationID: UUID,
                            TechnicianID: UUID,
                            startTime: Timestamp,
                            stopTime: Timestamp,
                            workDescription: String(1000),
                            findings: String(1000),
                            meterReading: Decimal(15, 3),
                            markCompleted: Boolean)                                 returns WorkOrderOperations;

    action completeOrder(WorkOrderID: UUID,
                         completionRemarks: LargeString,
                         closureCode: String(30))                                   returns WorkOrders;

    action closeOrder(WorkOrderID: UUID)                                            returns WorkOrders;

    action consumePart(WorkOrderID: UUID,
                       OperationID: UUID,
                       SparePartID: UUID,
                       TechnicianID: UUID,
                       quantity: Decimal(15, 3))                                    returns PartConsumptions;

    action convertToWorkOrder(RequestID: UUID,
                              orderType: EM.WorkOrderType,
                              category: EM.RequestCategory,
                              plannedStartDate: Timestamp,
                              plannedEndDate: Timestamp,
                              operations: many {
        operationName : String(150);
        plannedHours  : Decimal(10, 2);
        isMandatory   : Boolean;
    })                                                                              returns WorkOrders;

    action approveWorkOrder(WorkOrderID: UUID,
                            remarks: String(500))                                   returns WorkOrders;

    action rejectWorkOrder(WorkOrderID: UUID,
                           remarks: String(500))                                    returns WorkOrders;

    // Every work order of every equipment (equipment history)
    @readonly
    entity EquipmentHistory      as
        select from EM.WorkOrders {
            key ID,
                equipment.ID            as equipmentID,
                equipment.equipmentCode as equipmentCode,
                equipment.equipmentName as equipmentName,
                orderNumber,
                orderType,
                title,
                priority,
                status,
                plannedStartDate,
                actualStartDate,
                actualEndDate,
                plannedHours,
                actualHours,
                actualCost,
                closureCode
        };

    // Downtime per equipment
    @readonly
    entity DowntimeSummary       as
        select from EM.DowntimeEvents {
            key equipment.ID            as equipmentID,
                equipment.equipmentCode as equipmentCode,
                equipment.equipmentName as equipmentName,
                count( * )              as events       : Integer,
                sum(durationMinutes)    as totalMinutes : Integer,
                sum(case
                        when endTime is null
                             then 1
                        else 0
                    end)                as openEvents   : Integer
        }
        group by
            equipment.ID,
            equipment.equipmentCode,
            equipment.equipmentName;


    // Preventive maintenance compliance per plan
    @readonly
    entity PMCompliance          as
        select from EM.WorkOrders {
            key maintenancePlan.ID       as planID,
            key equipment.equipmentCode  as equipmentCode,

                maintenancePlan.planCode as planCode,
                maintenancePlan.planName as planName,

                count( * )               as totalOrders       : Integer,

                sum(case
                        when status = 'Completed'
                             or status = 'Closed'
                             then 1
                        else 0
                    end)                 as completedOrders   : Integer,

                sum(case
                        when status = 'Completed'
                             or status = 'Closed'
                             then 0
                        else 1
                    end)                 as openOrders        : Integer,

                (
                    sum(case
                            when status    = 'Completed'
                                 or status = 'Closed'
                                 then 1
                            else 0
                        end)               * 100
                ) / count( * )           as compliancePercent : Integer

        }
        where
            orderType = 'Preventive'
        group by
            maintenancePlan.ID,
            maintenancePlan.planCode,
            maintenancePlan.planName,
            equipment.equipmentCode;

    // Equipment with more than one breakdown (repeat failures)
    @readonly
    entity RepeatFailures        as
        select from EM.WorkOrders {
            key equipment.ID            as equipmentID,
                equipment.equipmentCode as equipmentCode,
                equipment.equipmentName as equipmentName,
                count( * )              as breakdowns : Integer
        }
        where
            orderType = 'Breakdown'
        group by
            equipment.ID,
            equipment.equipmentCode,
            equipment.equipmentName
        having
            count( * ) > 1;

}
