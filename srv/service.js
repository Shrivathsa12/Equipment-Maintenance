const cds = require('@sap/cds');
const { SELECT, orders } = require('@sap/cds/lib/ql/cds-ql');

module.exports = cds.service.impl(async function () {

    const { EquipmentLocations, Equipment, MaintenancePlans, MaintenanceRequests, WorkOrders, WorkOrderOperations, Technicians, TechnicianAssignments, TimeConfirmations, SpareParts, PartConsumptions, DowntimeEvents, EquipmentReadings, MaintenanceDocuments } = this.entities;


    // action for report breakdown 
    this.on("reportBreakdown", async (req) => {
        const { equipment, symptom, description, requestedPriority, safetyImpact, productionImpact, category, reportedBy, photos } = req.data;

        if (!equipment || !symptom || !description || !requestedPriority || !safetyImpact || !productionImpact || !category || !reportedBy)
            return req.reject(400, "All breakdown fields are required");

        if (!Array.isArray(photos) || !photos.length) return req.reject(400, "At least one photo is required");

        if (photos.length > 5) return req.reject(400, "Maximum 5 photos are allowed");

        const documents = [];

        for (const [i, photo] of photos.entries()) {
            if (!photo.fileName?.trim() || !photo.mimeType || !photo.content) return req.reject(400, `Photo ${i + 1}: file name, MIME type and content are required`);

            if (!["image/jpeg", "image/png", "image/webp"].includes(photo.mimeType.toLowerCase())) return req.reject(400, `Photo ${i + 1}: unsupported image format`);

            const content = Buffer.isBuffer(photo.content) ? photo.content : Buffer.from(photo.content, "base64");

            if (!content.length || content.length > 5 * 1024 * 1024)
                return req.reject(400, `Photo ${i + 1}: image must be between 1 byte and 5 MB`);

            documents.push({ ID: cds.utils.uuid(), fileName: photo.fileName, mimeType: photo.mimeType, documentType: "Photo", fileSize: content.length, content });
        }

        const equipmentData = await SELECT.one.from(Equipment).where({ ID: equipment });
        if (!equipmentData) return req.reject(404, "Equipment not found");

        const result = await SELECT.one.from(MaintenanceRequests).columns("count(*) as total");
        const requestNumber = `MR-${String(Number(result.total || 0) + 1).padStart(4, "0")}`;

        const criticalityPoints = { Low: 10, Medium: 20, High: 30, Critical: 40 };
        const impactPoints = { None: 0, Low: 10, Medium: 20, High: 30 };

        const priorityScore = (criticalityPoints[equipmentData.criticality] ?? 20) +
            (impactPoints[safetyImpact] ?? 0) +
            (impactPoints[productionImpact] ?? 0);

        const priority = priorityScore >= 80 ? "Critical" :
            priorityScore >= 60 ? "High" :
                priorityScore >= 40 ? "Medium" : "Low";

        const ID = cds.utils.uuid();

        await INSERT.into(MaintenanceRequests).entries({ ID, requestNumber, equipment_ID: equipment, location_ID: equipmentData.location_ID, symptom, description, requestedPriority, priority, priorityScore, safetyImpact, productionImpact, category, reportedBy, reportedAt: new Date().toISOString(), status: "Submitted" });

        await INSERT.into(MaintenanceDocuments).entries(documents.map(photo => ({ ...photo, maintenanceRequest_ID: ID })));

        if (equipmentData.criticality === "Critical") console.log("[ALERT] Critical breakdown:", equipmentData.equipmentCode, "-", symptom);

        return SELECT.one.from(MaintenanceRequests).where({ ID });
    });




    // action for creating PreventiveOrder
    this.on("createPreventiveOrder", async (req) => {
        const { PlanID } = req.data;

        if (!PlanID) req.reject("Plan ID is Required");

        const plan = await SELECT.one.from(MaintenancePlans).where({ ID: PlanID });
        if (!plan) req.reject("Maintance Plan not found")
        if (plan.isActive !== true) {
            return req.reject("Maintenance plan is not active");
        }

        const equipment = await SELECT.one.from(Equipment).where({ ID: plan.equipment_ID });
        if (!equipment) {
            return req.reject("Equipment not found");
        }

        const existingOrders = await SELECT.from(WorkOrders).where({ maintenancePlan_ID: PlanID, orderType: "Preventive" });

        const openOrder = existingOrders.find(order => order.status !== "Closed");

        if (openOrder) {
            return req.reject(
                `Preventive order already exists: ${openOrder.orderNumber}`
            );
        }

        const now = new Date();
        const today = new Date(now);
        today.setUTCHours(0, 0, 0, 0);

        let nextDueDate = plan.nextDueDate;
        let nextDueReading = plan.nextDueReading;
        let plannedStartDate;

        if (plan.triggerType === "Calendar") {
            if (!nextDueDate) {
                if (!plan.lastMaintenanceDate)
                    return req.reject(400, "Next due date is required for calendar plans");

                const calc = new Date(`${plan.lastMaintenanceDate}T00:00:00.000Z`);
                calc.setUTCDate(calc.getUTCDate() + Number(plan.intervalValue));
                nextDueDate = calc.toISOString().slice(0, 10);

                await UPDATE(MaintenancePlans).set({ nextDueDate }).where({ ID: PlanID });
            }

            const dueDate = new Date(`${nextDueDate}T00:00:00.000Z`);
            const triggerDate = new Date(dueDate);
            triggerDate.setUTCDate(triggerDate.getUTCDate() - Number(plan.leadDays || 0));

            if (today < triggerDate)
                return req.reject(400, `Preventive maintenance is not yet due. Order generation starts on ${triggerDate.toISOString().slice(0, 10)}`);

            // Overdue plans start now, not in the past
            plannedStartDate = (dueDate > now ? dueDate : now).toISOString();
        }
        else if (plan.triggerType === "Meter") {
            const readings = await SELECT.from(EquipmentReadings).where({ equipment_ID: equipment.ID }).orderBy({ readingDate: "desc" }).limit(1);

            const currentReading = readings.length ? Number(readings[0].readingValue) : Number(equipment.currentReading || 0);

            const baseline = Number(plan.lastMaintenanceReading ?? equipment.currentReading ?? 0);

            if (!nextDueReading) {
                nextDueReading = baseline + Number(plan.intervalValue);
                await UPDATE(MaintenancePlans).set({ nextDueReading }).where({ ID: PlanID });
            }

            if (currentReading < Number(nextDueReading))
                return req.reject(400, `Preventive maintenance is not yet due. Current reading: ${currentReading}, required reading: ${nextDueReading}`);

            plannedStartDate = now.toISOString();
        }
        else {
            return req.reject(400, "Unsupported maintenance trigger type");
        }

        const count = await SELECT.one.from(WorkOrders).columns("count(*) as total");
        const orderNumber = `WO-${String(Number(count.total || 0) + 1).padStart(4, "0")}`;

        const ID = cds.utils.uuid();

        await INSERT.into(WorkOrders).entries({
            ID,
            orderNumber,
            orderType: "Preventive",
            equipment_ID: equipment.ID,
            maintenancePlan_ID: PlanID,
            title: `Preventive Maintenance - ${plan.planName}`,
            description: `Preventive maintenance generated from plan ${plan.planCode}`,
            priority: equipment.criticality,
            status: "Created",
            approvalStatus: "NotRequired",
            plannedStartDate,
            // default mandatory operation so the order can be confirmed and completed later
            operations: [{
                sequenceNumber: 10,
                operationName: plan.planName,
                isMandatory: true
            }]
        });

        return await SELECT.one.from(WorkOrders).where({ ID });
    })


    // action for Assign Technicians
    this.on("assignTechnician", async (req) => {
        const { WorkOrderID, TechnicianID, isLead } = req.data;

        if (!WorkOrderID || !TechnicianID) {
            return req.reject("Work order id and technician id is required")
        }

        const workOrder = await SELECT.one.from(WorkOrders).where({ ID: WorkOrderID });
        if (!workOrder)
            return req.reject("Work Order not found");

        if (["Completed", "Closed"].includes(workOrder.status))
            return req.reject(400, "Cannot assign technician to a completed or closed work order");

        const technician = await SELECT.one.from(Technicians).where({ ID: TechnicianID })
        if (!technician)
            return req.reject("Technician not found");

        if (technician.isActive !== true)
            return req.reject("technician is not active ");

        const existingAssignment = await SELECT.one.from(TechnicianAssignments).where({ workOrder_ID: WorkOrderID, technician_ID: TechnicianID });
        if (existingAssignment)
            return req.reject("Technician is already assigned to this work order");

        // Prevent multiple lead technicians
        if (isLead === true) {
            const existingLead = await SELECT.one.from(TechnicianAssignments).where({ workOrder_ID: WorkOrderID, isLead: true });
            if (existingLead)
                return req.reject("A lead technician is already assigned to this work order");
        }

        // Create technician assignment
        await INSERT.into(TechnicianAssignments).entries({
            technicianUserId: technician.userId,
            isLead: isLead === true,
            assignedAt: new Date(),
            workOrder_ID: WorkOrderID,
            technician_ID: TechnicianID
        });

        // Update work order status
        await UPDATE(WorkOrders).set({ status: "Assigned" }).where({ ID: WorkOrderID });

        // Return updated work order
        return await SELECT.one.from(WorkOrders).where({ ID: WorkOrderID });
    })


    //action for release order
    this.on("releaseOrder", async (req) => {
        const { WorkOrderID } = req.data;

        if (!WorkOrderID)
            return req.reject("Work order id is required");

        const workOrders = await SELECT.one.from(WorkOrders).where({ ID: WorkOrderID });
        if (!workOrders)
            return req.reject("work order not found");
        if (workOrders.status !== "Assigned")
            return req.reject(`Work Order must be in Assigned status. Current status: ${workOrders.status}`);

        const assignments = await SELECT.from(TechnicianAssignments).where({ workOrder_ID: WorkOrderID });
        if (!assignments || assignments.length === 0)
            return req.reject("Assign at least one technician before releasing the work order");

        const operations = await SELECT.from(WorkOrderOperations).where({ workOrder_ID: WorkOrderID });
        if (!operations || operations.length === 0)
            return req.reject("Add at least one operation before releasing the work order");

        const sequences = operations.map(op => op.sequenceNumber);
        if (sequences.some(sequence => !Number.isInteger(sequence) || sequence <= 0) || new Set(sequences).size !== sequences.length) {
            return req.reject(400, "Operation sequence numbers must be positive and unique");
        }

        await UPDATE(WorkOrders).set({ status: "Released" }).where({ ID: WorkOrderID });

        return await SELECT.one.from(WorkOrders).where({ ID: WorkOrderID });



    })


});



