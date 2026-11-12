using {EquipmentMantain as EM} from '../db/schema';

service EquipmentMaintenance {
    entity EquipmentLocations    as projection on EM.EquipmentLocations;

    entity Equipment             as projection on EM.Equipment;

    entity MaintenancePlans      as projection on EM.MaintenancePlans;

    entity MaintenanceRequests   as projection on EM.MaintenanceRequests;

    entity WorkOrders            as projection on EM.WorkOrders;

    entity WorkOrderOperations   as projection on EM.WorkOrderOperations;

    entity Technicians           as projection on EM.Technicians;

    entity TechnicianAssignments as projection on EM.TechnicianAssignments;

    entity TimeConfirmations     as projection on EM.TimeConfirmations;

    entity SpareParts            as projection on EM.SpareParts;

    entity PartConsumptions      as projection on EM.PartConsumptions;

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


    action createPreventiveOrder(PlanID: UUID)                                      returns WorkOrders;

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
}
