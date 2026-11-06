namespace EquipmentMantain;

using {
    cuid,
    managed
} from '@sap/cds/common';


// Equipment Location Entity
entity EquipmentLocations : cuid, managed {
    locationCode   : String not null;
    locationName   : String not null;
    parentLocation : Association to EquipmentLocations;

}

entity Equipment : cuid, managed {
    equipmentCode  : String not null;
    equipmentName  : String not null;
    description    : String;
    manufacture    : String;
    serialNumber   : String;
    Criticality    : Criticality default 'Medium';
    warantyEndDate : Date;
    meterUnit      : String;
    currentReading : Decimal(10, 2) default 0;

}

entity MaintancePlans : cuid, managed {
    planCode             : String not null;
    planName             : String;
    triggerType          : PlanTrigger not null;
    interValue           : Decimal(15, 2) default 0;
    leadDays             : Integer default 7;
    lastMaintanceDate    : Date;
    lastMaintanceReading : Decimal(10, 2);
    nextDueDate          : Date;
    nextDueReading       : Decimal(10, 2);
    isActive             : Boolean default true;

}

entity MaintenanceRequests : cuid, managed {
    requestNumber     : String not null;
    reportedBy        : String;
    reportedAt        : Timestamp;
    symptom           : String not null;
    description       : String;
    requestedPriority : Priority;
    priority          : Priority;
    priorityScore     : Integer;
    safetyImpact      : ImpactLevel default 'None';
    productionImapact : ImpactLevel default 'None';
    category          : RequestCategory;
    status            : RequestStatus default 'Pending';

}

entity WorkOrders : cuid, managed {
    orderNumber       : String(30) not null;
    orderType         : WorkOrderType not null;
    title             : String(150) not null;
    description       : String(1000);
    priority          : Priority;
    priorityScore     : Integer;
    status            : WorkOrderStatus default 'Created';
    plannedStartDate  : Timestamp;
    plannedEndDate    : Timestamp;
    actualStartDate   : Timestamp;
    actualEndDate     : Timestamp;
    plannedHours      : Decimal(10, 2);
    actualHours       : Decimal(10, 2);
    estimatedCost     : Decimal(15, 2) default 0;
    actualCost        : Decimal(15, 2) default 0;
    approvalStatus    : ApprovalStatus default 'NotRequired';
    approvedBy        : String(100);
    approvalAt        : Timestamp;
    approvalRemarks   : String(1000);
    closureCode       : ClosureCode;
    completionRemarks : String(1000);
    completedBy       : String(100);
    closedBy          : String(100);
    closedAt          : Timestamp;

}

entity WorkOrderOperations : cuid, managed {
    workOrder      : Association to WorkOrders not null;
    sequenceNumber : Integer not null;
    operationName  : String(150) not null;
    plannedHours   : Decimal(10, 2) default 0;
    actualHours    : Decimal(10, 2);
    isMandatory    : Boolean default true;
    status         : OperationStatus default 'Pending';

}

entity Technicians : cuid, managed {
    userId   : String(100) not null;
    name     : String(100) not null;
    email    : String(150);
    skill    : String(100);
    isActive : Boolean default true;
}

entity TechnicianAssignmemnts : cuid, managed {
    workOrder        : Association to WorkOrders not null;
    technician       : Association to Technicians not null;
    technicianUserId : String(100);
    isLead           : Boolean default false;
    assignedAt       : Timestamp;
}

entity TimeConfirmations : cuid, managed {
    technicianUserId : String(100) not null;
    startTime        : Timestamp not null;
    stopTime         : Timestamp;
    actualHours      : Decimal(10, 2);
    workDescription  : String(1000);
    findings         : String(1000);
    meterReading     : Decimal(10, 2);
}

entity SpareParts : cuid, managed {
    partNumber    : String(50) not null;
    partName      : String(150) not null;
    unitOfMeasure : String(20);
    standardCost  : Decimal(15, 2) default 0;
    stockQuantity : Decimal(10, 2) default 0;
}

entity PartConsumption : cuid {
    quantity    : Decimal(10, 2) not null;
    unitCost    : Decimal(10, 2);
    totalCost   : Decimal(10, 2);
    consumnedAt : Timestamp;
}

entity DownTimeEvents : cuid, managed {
    startTime        : Timestamp not null;
    endTime          : Timestamp;
    durantionMinutes : Integer;
    reason           : String;
    isPlanned        : Boolean default false;
}

entity EquipmentReadings : cuid, managed {
    equipment    : Association to Equipment not null;
    readingValue : Decimal(15, 3) not null;
    readingDate  : Timestamp not null;
}

entity MaintenanceDocuments : cuid, managed {
    fileName           : String(255) not null;

    @Core.IsMediaType
    mimeType           : String(100) not null;
    documentType       : DocumentType default 'Photo';
    fileSize           : Integer64;

    @Core.MediaType                  : mimeType
    @Core.ContentDisposition.Filename: fileName
    content            : LargeBinary;
    equipment          : Association to Equipment;
    maintenanceRequest : Association to MaintenanceRequests;
    workOrder          : Association to WorkOrders;
}

type Criticality     : String enum {
    Low;
    Medium;
    High;
    Critica
};

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
