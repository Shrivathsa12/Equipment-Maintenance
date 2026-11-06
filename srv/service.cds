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


}
