namespace EquipmentMantain;

using {
    cuid,
    managed
} from '@sap/cds/common';

// EQUIPMENT LOCATION ENTITY
@assert.unique: {locationCode: [locationCode]}
entity EquipmentLocations : cuid, managed {
    locationCode   : String(30) not null;
    locationName   : String(100) not null;
    parentLocation : Association to EquipmentLocations;
}


// EQUIPMENT ENTITY


@assert.unique: {equipmentCode: [equipmentCode]}
entity Equipment : cuid, managed {
    equipmentCode    : String(30) not null;
    equipmentName    : String(100) not null;
    description      : String(500);
    manufacturer     : String(100);
    serialNumber     : String(100);

    criticality      : Criticality default #Medium;
    warrantyEndDate  : Date;

    meterUnit        : String(20);
    currentReading   : Decimal(15, 3) default 0;

    location         : Association to EquipmentLocations not null;
    parentEquipment  : Association to Equipment;
    childEquipment   : Association to many Equipment
                           on childEquipment.parentEquipment = $self;

    maintenancePlans : Composition of many MaintenancePlans
                           on maintenancePlans.equipment = $self;

    readings         : Composition of many EquipmentReadings
                           on readings.equipment = $self;

    documents        : Composition of many MaintenanceDocuments
                           on documents.equipment = $self;
}


// MAINTENANCE PLAN ENTITY


@assert.unique: {planCode: [planCode]}
entity MaintenancePlans : cuid, managed {
    planCode               : String(30) not null;
    planName               : String(100) not null;

    triggerType            : PlanTrigger not null;
    intervalValue          : Decimal(15, 3) not null;
    leadDays               : Integer default 7;

    lastMaintenanceDate    : Date;
    lastMaintenanceReading : Decimal(15, 3);
    nextDueDate            : Date;
    nextDueReading         : Decimal(15, 3);

    isActive               : Boolean default true;

    equipment              : Association to Equipment not null;
}


// MAINTENANCE REQUEST ENTITY


@assert.unique: {requestNumber: [requestNumber]}
entity MaintenanceRequests : cuid, managed {
    requestNumber     : String(30) not null;

    reportedBy        : String(100) not null;
    reportedAt        : Timestamp;

    symptom           : String(255) not null;
    description       : String(1000);

    requestedPriority : Priority;
    priority          : Priority;
    priorityScore     : Integer;

    safetyImpact      : ImpactLevel default #None;
    productionImpact  : ImpactLevel default #None;

    category          : RequestCategory;
    status            : RequestStatus default #Submitted;

    equipment         : Association to Equipment not null;
    location          : Association to EquipmentLocations;
    workOrder         : Association to WorkOrders;

    documents         : Composition of many MaintenanceDocuments
                            on documents.maintenanceRequest = $self;
}


// WORK ORDER ENTITY


@assert.unique: {orderNumber: [orderNumber]}
entity WorkOrders : cuid, managed {
    orderNumber        : String(30) not null;
    orderType          : WorkOrderType not null;

    title              : String(150) not null;
    description        : String(1000);

    priority           : Priority;
    priorityScore      : Integer;
    status             : WorkOrderStatus default #Created;

    plannedStartDate   : Timestamp;
    plannedEndDate     : Timestamp;
    actualStartDate    : Timestamp;
    actualEndDate      : Timestamp;

    plannedHours       : Decimal(10, 2);
    actualHours        : Decimal(10, 2);

    estimatedCost      : Decimal(15, 2) default 0;
    actualCost         : Decimal(15, 2) default 0;

    approvalStatus     : ApprovalStatus default #NotRequired;
    approvedBy         : String(100);
    approvalAt         : Timestamp;
    approvalRemarks    : String(1000);

    closureCode        : ClosureCode;
    completionRemarks  : String(1000);
    completedBy        : String(100);
    closedBy           : String(100);
    closedAt           : Timestamp;

    equipment          : Association to Equipment not null;
    maintenanceRequest : Association to MaintenanceRequests;
    maintenancePlan    : Association to MaintenancePlans;

    operations         : Composition of many WorkOrderOperations
                             on operations.workOrder = $self;

    assignments        : Composition of many TechnicianAssignments
                             on assignments.workOrder = $self;

    confirmations      : Composition of many TimeConfirmations
                             on confirmations.workOrder = $self;

    partConsumptions   : Composition of many PartConsumptions
                             on partConsumptions.workOrder = $self;

    documents          : Composition of many MaintenanceDocuments
                             on documents.workOrder = $self;
}


// WORK ORDER OPERATION ENTITY


entity WorkOrderOperations : cuid, managed {
    sequenceNumber : Integer not null;
    operationName  : String(150) not null;
    plannedHours   : Decimal(10, 2) default 0;
    actualHours    : Decimal(10, 2);
    isMandatory    : Boolean default true;
    status         : OperationStatus default #Pending;

    workOrder      : Association to WorkOrders not null;
}


// TECHNICIAN ENTITY


@assert.unique: {userId: [userId]}
entity Technicians : cuid, managed {
    userId   : String(100) not null;
    name     : String(100) not null;
    email    : String(150);
    skill    : String(100);
    isActive : Boolean default true;
}


//  TECHNICIAN ASSIGNMENT ENTITY


entity TechnicianAssignments : cuid, managed {
    technicianUserId : String(100);
    isLead           : Boolean default false;
    assignedAt       : Timestamp;

    workOrder        : Association to WorkOrders not null;
    technician       : Association to Technicians not null;
}


// TIME CONFIRMATION ENTITY


entity TimeConfirmations : cuid, managed {
    technicianUserId : String(100) not null;

    startTime        : Timestamp not null;
    stopTime         : Timestamp;
    actualHours      : Decimal(10, 2);

    workDescription  : String(1000);
    findings         : String(1000);
    meterReading     : Decimal(15, 3);

    workOrder        : Association to WorkOrders not null;
    operation        : Association to WorkOrderOperations not null;
    technician       : Association to Technicians not null;
}


// SPARE PART ENTITY


@assert.unique: {partNumber: [partNumber]}
entity SpareParts : cuid, managed {
    partNumber    : String(50) not null;
    partName      : String(150) not null;
    unitOfMeasure : String(20);
    standardCost  : Decimal(15, 2) default 0;
    stockQuantity : Decimal(15, 3) default 0;
}


// PART CONSUMPTION ENTITY


entity PartConsumptions : cuid, managed {
    quantity   : Decimal(15, 3) not null;
    unitCost   : Decimal(15, 2);
    totalCost  : Decimal(15, 2);
    consumedAt : Timestamp;

    workOrder  : Association to WorkOrders not null;
    operation  : Association to WorkOrderOperations;
    sparePart  : Association to SpareParts not null;
}


// DOWNTIME EVENT ENTITY


entity DowntimeEvents : cuid, managed {
    startTime       : Timestamp not null;
    endTime         : Timestamp;
    durationMinutes : Integer;
    reason          : String(500);
    isPlanned       : Boolean default false;

    equipment       : Association to Equipment not null;
    workOrder       : Association to WorkOrders;
}


//  EQUIPMENT READING ENTITY


entity EquipmentReadings : cuid, managed {
    readingValue : Decimal(15, 3) not null;
    readingDate  : Timestamp not null;

    equipment    : Association to Equipment not null;
}


// MAINTENANCE DOCUMENT ENTITY


entity MaintenanceDocuments : cuid, managed {
    fileName           : String(255) not null;

    @Core.IsMediaType
    mimeType           : String(100) not null;

    documentType       : DocumentType default #Photo;
    fileSize           : Integer64;

    @Core.MediaType                  : mimeType
    @Core.ContentDisposition.Filename: fileName
    content            : LargeBinary;

    equipment          : Association to Equipment;
    maintenanceRequest : Association to MaintenanceRequests;
    workOrder          : Association to WorkOrders;
}

// ENUM TYPES
type Criticality     : String enum {
    Low;
    Medium;
    High;
    Critical;
}

type Priority        : String enum {
    Low;
    Medium;
    High;
    Critical;
}

type ImpactLevel     : String enum {
    None;
    Low;
    Medium;
    High;
}


type RequestCategory : String enum {
    Mechanical;
    Electrical;
    Instrumentation;
    Other;
}


type RequestStatus   : String enum {
    Submitted;
    UnderReview;
    Converted;
    Rejected;
}


type PlanTrigger     : String enum {
    Calendar;
    Meter;
}


type WorkOrderType   : String enum {
    Breakdown;
    Corrective;
    Preventive;
}


type WorkOrderStatus : String enum {
    Created;
    Planned;
    Assigned;
    Released;
    InProgress;
    Completed;
    Closed;
}

type OperationStatus : String enum {
    Pending;
    InProgress;
    Completed;
}


type ApprovalStatus  : String enum {
    NotRequired;
    Pending;
    Approved;
    Rejected;
}

type ClosureCode     : String enum {
    Repaired;
    Replaced;
    Adjusted;
    NoFaultFound;
    Other;
}

type DocumentType    : String enum {
    Photo;
    Manual;
    Report;
}
