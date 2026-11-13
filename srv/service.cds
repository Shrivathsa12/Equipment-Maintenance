using {EquipmentMantain as EM} from '../db/schema';

@requires: 'authenticated-user'
service EquipmentMaintenance {
    @restrict: [
        {
            grant: 'READ',
            to   : 'authenticated-user'
        },
        {
            grant: [
                'CREATE',
                'UPDATE',
                'DELETE'
            ],
            to   : 'MaintenancePlanner'
        }
    ]
    entity EquipmentLocations    as projection on EM.EquipmentLocations;

    @restrict: [
        {
            grant: 'READ',
            to   : 'authenticated-user'
        },
        {
            grant: [
                'CREATE',
                'UPDATE',
                'DELETE'
            ],
            to   : 'MaintenancePlanner'
        }
    ]
    entity Equipment             as projection on EM.Equipment;

    @restrict: [
        {
            grant: 'READ',
            to   : 'authenticated-user'
        },
        {
            grant: [
                'CREATE',
                'UPDATE',
                'DELETE'
            ],
            to   : 'MaintenancePlanner'
        }
    ]
    entity MaintenancePlans      as projection on EM.MaintenancePlans;

    @restrict: [
        {
            grant: [
                'READ',
                'UPDATE'
            ],
            to   : 'MaintenancePlanner'
        },
        {
            grant: 'READ',
            to   : 'MaintenanceManager'
        },
        {
            grant: 'READ',
            to   : 'ProductionUser',
            where: 'reportedBy = $user'
        }
    ]
    entity MaintenanceRequests   as projection on EM.MaintenanceRequests;

    @restrict: [
        {
            grant: 'READ',
            to   : [
                'MaintenancePlanner',
                'MaintenanceManager'
            ]
        },
        {
            grant: 'READ',
            to   : 'Technician',
            where: 'exists assignments[technicianUserId = $user]'
        }
    ]
    @cds.redirection.target
    entity WorkOrders            as projection on EM.WorkOrders;

    @restrict: [
        {
            grant: 'READ',
            to   : [
                'MaintenancePlanner',
                'MaintenanceManager'
            ]
        },
        {
            grant: 'READ',
            to   : 'Technician',
            where: 'exists workOrder.assignments[technicianUserId = $user]'
        }
    ]
    entity WorkOrderOperations   as projection on EM.WorkOrderOperations;

    @restrict: [
        {
            grant: 'READ',
            to   : 'authenticated-user'
        },
        {
            grant: [
                'CREATE',
                'UPDATE',
                'DELETE'
            ],
            to   : 'MaintenancePlanner'
        }
    ]
    entity Technicians           as projection on EM.Technicians;

    @restrict: [
        {
            grant: 'READ',
            to   : [
                'MaintenancePlanner',
                'MaintenanceManager'
            ]
        },
        {
            grant: 'READ',
            to   : 'Technician',
            where: 'technicianUserId = $user'
        }
    ]
    entity TechnicianAssignments as projection on EM.TechnicianAssignments;

    @restrict: [
        {
            grant: 'READ',
            to   : [
                'MaintenancePlanner',
                'MaintenanceManager'
            ]
        },
        {
            grant: 'READ',
            to   : 'Technician',
            where: 'technicianUserId = $user'
        }
    ]
    entity TimeConfirmations     as projection on EM.TimeConfirmations;

    @restrict: [
        {
            grant: 'READ',
            to   : 'authenticated-user'
        },
        {
            grant: [
                'CREATE',
                'UPDATE',
                'DELETE'
            ],
            to   : 'MaintenancePlanner'
        }
    ]
    entity SpareParts            as projection on EM.SpareParts;

    @restrict: [
        {
            grant: 'READ',
            to   : [
                'MaintenancePlanner',
                'MaintenanceManager'
            ]
        },
        {
            grant: 'READ',
            to   : 'Technician',
            where: 'exists workOrder.assignments[technicianUserId = $user]'
        }
    ]
    entity PartConsumptions      as projection on EM.PartConsumptions;

    @restrict: [{
        grant: 'READ',
        to   : [
            'MaintenancePlanner',
            'MaintenanceManager'
        ]
    }]
    @cds.redirection.target
    entity DowntimeEvents        as projection on EM.DowntimeEvents;

    @restrict: [{
        grant: 'READ',
        to   : [
            'MaintenancePlanner',
            'MaintenanceManager',
            'Technician'
        ]
    }]
    entity EquipmentReadings     as projection on EM.EquipmentReadings;

    @restrict: [
        {
            grant: 'READ',
            to   : 'authenticated-user'
        },
        {
            grant: 'CREATE',
            to   : [
                'ProductionUser',
                'MaintenancePlanner',
                'Technician'
            ]
        }
    ]
    entity MaintenanceDocuments  as projection on EM.MaintenanceDocuments;

    // action
    @requires: [
        'ProductionUser',
        'MaintenancePlanner'
    ]
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
    @requires: 'MaintenancePlanner'
    action createPreventiveOrder(PlanID: UUID)                                      returns WorkOrders;

    // ACTION FOR jOB SCHEDULAR
    @requires: 'MaintenancePlanner'
    action generateDuePreventiveOrders()                                            returns many WorkOrders;

    @requires: 'MaintenancePlanner'
    action assignTechnician(WorkOrderID: UUID, TechnicianID: UUID, isLead: Boolean) returns WorkOrders;

    @requires: 'MaintenancePlanner'
    action releaseOrder(WorkOrderID: UUID)                                          returns WorkOrders;

    @requires: 'Technician'
    action confirmOperation(WorkOrderID: UUID,
                            OperationID: UUID,
                            TechnicianID: UUID,
                            startTime: Timestamp,
                            stopTime: Timestamp,
                            workDescription: String(1000),
                            findings: String(1000),
                            meterReading: Decimal(15, 3),
                            markCompleted: Boolean)                                 returns WorkOrderOperations;

    @requires: 'Technician'
    action completeOrder(WorkOrderID: UUID,
                         completionRemarks: LargeString,
                         closureCode: String(30))                                   returns WorkOrders;

    @requires: 'MaintenanceManager'
    action closeOrder(WorkOrderID: UUID)                                            returns WorkOrders;

    @requires: 'Technician'
    action consumePart(WorkOrderID: UUID,
                       OperationID: UUID,
                       SparePartID: UUID,
                       TechnicianID: UUID,
                       quantity: Decimal(15, 3))                                    returns PartConsumptions;

    @requires: 'MaintenancePlanner'
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

    @requires: 'MaintenanceManager'
    action approveWorkOrder(WorkOrderID: UUID,
                            remarks: String(500))                                   returns WorkOrders;

    @requires: 'MaintenanceManager'
    action rejectWorkOrder(WorkOrderID: UUID,
                           remarks: String(500))                                    returns WorkOrders;

    // Every work order of every equipment (equipment history)
    @restrict: [{
        grant: 'READ',
        to   : [
            'MaintenancePlanner',
            'MaintenanceManager'
        ]
    }]
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

   

    // Equipment with more than one breakdown (repeat failures)
    @restrict: [{
        grant: 'READ',
        to   : [
            'MaintenancePlanner',
            'MaintenanceManager'
        ]
    }]
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
