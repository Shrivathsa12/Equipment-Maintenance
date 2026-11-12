const cds = require('@sap/cds');

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
    /*     this.on("createPreventiveOrder", async (req) => {
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
        }) */


    async function createPreventiveOrderForPlan(PlanID) {
        const plan = await SELECT.one.from(MaintenancePlans).where({ ID: PlanID });

        if (!plan)
            throw new Error("Maintenance plan not found");

        if (plan.isActive !== true)
            throw new Error("Maintenance plan is not active");

        const equipment = await SELECT.one.from(Equipment)
            .where({ ID: plan.equipment_ID });

        if (!equipment)
            throw new Error("Equipment not found");

        const existingOrders = await SELECT.from(WorkOrders)
            .where({
                maintenancePlan_ID: PlanID,
                orderType: "Preventive"
            });

        const openOrder = existingOrders.find(order => order.status !== "Closed");

        if (openOrder)
            return {
                created: false,
                reason: `Preventive order already exists: ${openOrder.orderNumber}`
            };

        const now = new Date();
        const today = new Date(now);
        today.setUTCHours(0, 0, 0, 0);

        let plannedStartDate;

        if (plan.triggerType === "Calendar") {
            const intervalDays = Number(plan.intervalValue);
            const leadDays = Number(plan.leadDays || 0);

            if (!Number.isInteger(intervalDays) || intervalDays <= 0)
                throw new Error("Calendar intervalValue must be a positive whole number of days");

            if (!Number.isInteger(leadDays) || leadDays < 0)
                throw new Error("leadDays must be zero or a positive whole number");

            let nextDueDate = plan.nextDueDate;

            if (!nextDueDate) {
                if (!plan.lastMaintenanceDate)
                    throw new Error("Next due date or last maintenance date is required");

                const calculatedDate = new Date(`${plan.lastMaintenanceDate}T00:00:00.000Z`);
                calculatedDate.setUTCDate(calculatedDate.getUTCDate() + intervalDays);

                nextDueDate = calculatedDate.toISOString().slice(0, 10);

                await UPDATE(MaintenancePlans).set({ nextDueDate }).where({ ID: PlanID });
            }

            const dueDate = new Date(`${nextDueDate}T00:00:00.000Z`);

            if (Number.isNaN(dueDate.getTime()))
                throw new Error("Invalid nextDueDate in maintenance plan");

            const triggerDate = new Date(dueDate);
            triggerDate.setUTCDate(triggerDate.getUTCDate() - leadDays);

            if (today < triggerDate)
                return {
                    created: false,
                    reason: `Not due until ${triggerDate.toISOString().slice(0, 10)}`
                };

            plannedStartDate = dueDate > now
                ? dueDate.toISOString()
                : now.toISOString();
        }
        else if (plan.triggerType === "Meter") {
            const interval = Number(plan.intervalValue);

            if (!Number.isFinite(interval) || interval <= 0)
                throw new Error("Meter intervalValue must be greater than zero");

            const readings = await SELECT.from(EquipmentReadings).where({ equipment_ID: equipment.ID }).orderBy({ readingDate: "desc" }).limit(1);

            const currentReading = readings.length ? Number(readings[0].readingValue) : Number(equipment.currentReading || 0);

            let nextDueReading = plan.nextDueReading;

            if (nextDueReading === null || nextDueReading === undefined) {
                const baseline = Number(
                    plan.lastMaintenanceReading ?? equipment.currentReading ?? 0
                );

                nextDueReading = baseline + interval;

                await UPDATE(MaintenancePlans).set({ nextDueReading }).where({ ID: PlanID });
            }

            if (currentReading < Number(nextDueReading))
                return {
                    created: false,
                    reason: `Current reading ${currentReading}; required reading ${nextDueReading}`
                };

            plannedStartDate = now.toISOString();
        }
        else {
            throw new Error("Unsupported maintenance trigger type");
        }

        const existingNumbers = await SELECT.from(WorkOrders).columns("orderNumber");

        let maxNumber = 0;

        for (const order of existingNumbers) {
            const match = /^WO-(\d+)$/.exec(order.orderNumber || "");

            if (match)
                maxNumber = Math.max(maxNumber, Number(match[1]));
        }

        const orderNumber = `WO-${String(maxNumber + 1).padStart(4, "0")}`;
        const workOrderID = cds.utils.uuid();

        await INSERT.into(WorkOrders).entries({
            ID: workOrderID,
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
            operations: [{
                ID: cds.utils.uuid(),
                sequenceNumber: 10,
                operationName: plan.planName,
                plannedHours: 1,
                isMandatory: true,
                status: "Pending"
            }]
        });

        const workOrder = await SELECT.one.from(WorkOrders).where({ ID: workOrderID });

        return {
            created: true,
            workOrder
        };
    }


    // Manual generation for one plan
    this.on("createPreventiveOrder", async (req) => {
        const { PlanID } = req.data;

        if (!PlanID)
            return req.reject(400, "Plan ID is required");

        let result;
        try {
            result = await createPreventiveOrderForPlan(PlanID);
        } catch (error) {
            return req.reject(400, error.message);
        }

        if (!result.created)
            return req.reject(409, result.reason);

        return result.workOrder;
    });


    // Automatic generation for all active plans
    this.on("generateDuePreventiveOrders", async (req) => {
        const plans = await SELECT.from(MaintenancePlans)
            .where({ isActive: true });

        const createdOrders = [];

        for (const plan of plans) {
            try {
                const result = await createPreventiveOrderForPlan(plan.ID);

                if (result.created)
                    createdOrders.push(result.workOrder);
            }
            catch (error) {
                console.error(
                    `[PM Scheduler] Plan ${plan.planCode}: ${error.message}`
                );
            }
        }

        return createdOrders;
    });

    // action for Assign Technicians
    this.on("assignTechnician", async (req) => {
        const { WorkOrderID, TechnicianID, isLead } = req.data;

        if (!WorkOrderID || !TechnicianID) {
            return req.reject("Work order id and technician id is required")
        }

        const workOrder = await SELECT.one.from(WorkOrders).where({ ID: WorkOrderID });
        if (!workOrder)
            return req.reject("Work Order not found");

        if (!["Created", "Planned", "Assigned"].includes(workOrder.status))
            return req.reject(409, `Cannot assign technician when order is ${workOrder.status}`);;

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


    // action for confirm operation
    this.on("confirmOperation", async (req) => {
        const { WorkOrderID, OperationID, TechnicianID, startTime, stopTime, workDescription, findings, meterReading, markCompleted } = req.data;

        if (!WorkOrderID || !OperationID || !TechnicianID || !startTime || !stopTime)
            return req.reject(400, "Work Order, Operation, Technician, start time and stop time are required");

        if (markCompleted !== undefined && typeof markCompleted !== "boolean")
            return req.reject(400, "markCompleted must be true or false");

        const start = new Date(startTime);
        const stop = new Date(stopTime);

        if (isNaN(start.getTime()) || isNaN(stop.getTime()))
            return req.reject(400, "Invalid start time or stop time");

        if (stop <= start)
            return req.reject(400, "Stop time must be after start time");

        if (stop > new Date())
            return req.reject(400, "Stop time cannot be in the future");

        const hours = Number(((stop.getTime() - start.getTime()) / 3600000).toFixed(2));

        const workOrder = await SELECT.one.from(WorkOrders).where({ ID: WorkOrderID });

        if (!workOrder)
            return req.reject(404, "Work Order not found");

        if (!["Released", "InProgress"].includes(workOrder.status))
            return req.reject(409, `Work Order must be Released or InProgress. Current status: ${workOrder.status}`);

        const operation = await SELECT.one.from(WorkOrderOperations).where({ ID: OperationID, workOrder_ID: WorkOrderID });

        if (!operation)
            return req.reject(404, "Operation not found for this work order");

        if (operation.status === "Completed")
            return req.reject(409, "This operation is already completed");

        const technician = await SELECT.one.from(Technicians).where({ ID: TechnicianID });

        if (!technician)
            return req.reject(404, "Technician not found");

        if (technician.isActive !== true)
            return req.reject(400, "Technician is inactive");

        const assignment = await SELECT.one.from(TechnicianAssignments)
            .where({ workOrder_ID: WorkOrderID, technician_ID: TechnicianID });

        if (!assignment)
            return req.reject(400, "Technician is not assigned to this work order");

        // Earlier mandatory operations must be completed first
        const previousOperations = await SELECT.from(WorkOrderOperations)
            .where({ workOrder_ID: WorkOrderID, sequenceNumber: { "<": operation.sequenceNumber }, isMandatory: true });

        const incompletePrevious = previousOperations.find(op => op.status !== "Completed");

        if (incompletePrevious)
            return req.reject(400, `Complete previous mandatory operation ${incompletePrevious.sequenceNumber} first`);

        // Validate equipment meter reading
        if (meterReading !== undefined && meterReading !== null) {
            const equipment = await SELECT.one.from(Equipment).where({ ID: workOrder.equipment_ID });

            if (!equipment)
                return req.reject(404, "Equipment not found");

            if (Number(meterReading) < Number(equipment.currentReading || 0))
                return req.reject(400, "Meter reading cannot be lower than current reading");
        }

        // Insert time confirmation
        await INSERT.into(TimeConfirmations).entries({
            technicianUserId: technician.userId,
            startTime: start.toISOString(),
            stopTime: stop.toISOString(),
            actualHours: hours,
            workDescription,
            findings,
            meterReading,
            workOrder_ID: WorkOrderID,
            operation_ID: OperationID,
            technician_ID: TechnicianID
        });

        // Update equipment reading
        if (meterReading !== undefined && meterReading !== null) {
            await INSERT.into(EquipmentReadings).entries({
                equipment_ID: workOrder.equipment_ID,
                readingValue: meterReading,
                readingDate: stop.toISOString()
            });

            await UPDATE(Equipment)
                .set({ currentReading: meterReading })
                .where({ ID: workOrder.equipment_ID });
        }

        // Update operation
        await UPDATE(WorkOrderOperations)
            .set({
                status: markCompleted === true ? "Completed" : "InProgress",
                actualHours: Number((Number(operation.actualHours || 0) + hours).toFixed(2))
            })
            .where({ ID: OperationID });

        // Calculate work order actual hours
        const confirmations = await SELECT.from(TimeConfirmations)
            .columns("actualHours", "startTime")
            .where({ workOrder_ID: WorkOrderID });

        const totalActualHours = Number(
            confirmations.reduce((total, item) => total + Number(item.actualHours || 0), 0).toFixed(2)
        );

        const earliestStart = confirmations
            .map(item => new Date(item.startTime))
            .filter(date => !isNaN(date.getTime()))
            .sort((a, b) => a - b)[0];

        // Update work order
        await UPDATE(WorkOrders)
            .set({
                status: "InProgress",
                actualStartDate: workOrder.actualStartDate || earliestStart.toISOString(),
                actualHours: totalActualHours
            })
            .where({ ID: WorkOrderID });

        return await SELECT.one.from(WorkOrderOperations).where({ ID: OperationID });
    });

    // action for complete order

    this.on("completeOrder", async (req) => {
        const { WorkOrderID, closureCode, completionRemarks } = req.data;

        if (!WorkOrderID)
            return req.reject("Work order ID is required.");

        if (!closureCode?.trim())
            return req.reject("Closure code is required.");


        if (!["Repaired", "Replaced", "Adjusted", "NoFaultFound", "Other"].includes(closureCode.trim()))
            return req.reject("Invalid closure code. Allowed: Repaired, Replaced, Adjusted, NoFaultFound, Other.");

        if (!completionRemarks?.trim())
            return req.reject("Completion remarks are required.");

        const workOrder = await SELECT.one.from(WorkOrders).where({ ID: WorkOrderID });
        if (!workOrder)
            return req.reject("Work order not found.");

        if (workOrder.status !== "InProgress")
            return req.reject(`Work order must be InProgress. Current status: ${workOrder.status}`);


        const operations = await SELECT.from(WorkOrderOperations).where({ workOrder_ID: WorkOrderID });
        if (!operations.length)
            return req.reject("Work order has no operations.");

        const pendingOperations = operations.filter(op => op.isMandatory && op.status !== "Completed");
        if (pendingOperations.length)
            return req.reject(`Mandatory operations not completed: ${pendingOperations.map(op => op.sequenceNumber).sort((a, b) => a - b).join(", ")}`);


        const confirmations = await SELECT.from(TimeConfirmations)
            .columns("actualHours", "stopTime")
            .where({ workOrder_ID: WorkOrderID });
        if (!confirmations.length)
            return req.reject("At least one time confirmation is required.");

        const validStops = confirmations.map(c => new Date(c.stopTime));
        if (validStops.some(d => Number.isNaN(d.getTime())))
            return req.reject("All time confirmations must have valid stop times.");


        let actualHours = 0;
        for (const confirmation of confirmations) {
            const hours = Number(confirmation.actualHours || 0);
            if (!Number.isFinite(hours) || hours < 0)
                return req.reject("Invalid actual hours in time confirmation.");
            actualHours += hours;
        }
        actualHours = Number(actualHours.toFixed(2));

        const latestStop = new Date(Math.max(...validStops.map(d => d.getTime())));
        const actualEndDate = latestStop.toISOString();


        const parts = await SELECT.from(PartConsumptions).columns("totalCost").where({ workOrder_ID: WorkOrderID });

        let actualCost = 0;
        for (const part of parts) {
            const cost = Number(part.totalCost || 0);
            if (!Number.isFinite(cost) || cost < 0)
                return req.reject("Invalid spare part consumption cost.");
            actualCost += cost;
        }
        actualCost = Number(actualCost.toFixed(2));
        const estimatedCost = Number(workOrder.estimatedCost || 0);
        if (!Number.isFinite(estimatedCost) || estimatedCost < 0)
            return req.reject("Invalid estimated work order cost.");

        const approvalRequired = estimatedCost > MANAGER_APPROVAL_LIMIT || actualCost > MANAGER_APPROVAL_LIMIT;
        const approvalStatus = approvalRequired ? "Pending" : "NotRequired";

        const openDowntime = await SELECT.from(DowntimeEvents).where({ workOrder_ID: WorkOrderID, endTime: null });

        for (const downtime of openDowntime) {
            const startTime = new Date(downtime.startTime);
            if (Number.isNaN(startTime.getTime()))
                return req.reject("Invalid downtime start time.");

            const durationMinutes = Math.max(0, Math.round((latestStop.getTime() - startTime.getTime()) / 60000));

            await UPDATE(DowntimeEvents)
                .set({ endTime: actualEndDate, durationMinutes })
                .where({ ID: downtime.ID });
        }

        // 9. Update work order
        await UPDATE(WorkOrders)
            .set({
                status: "Completed",
                closureCode: closureCode.trim(),
                completionRemarks: completionRemarks.trim(),
                completedBy: req.user.id,
                actualEndDate,
                actualHours,
                actualCost,
                approvalStatus
            })
            .where({ ID: WorkOrderID });

        return await SELECT.one.from(WorkOrders).where({ ID: WorkOrderID });
    });


    // Action for closing work order
    this.on("closeOrder", async (req) => {
        const { WorkOrderID } = req.data;

        if (!WorkOrderID)
            return req.reject("Work order ID is required.");


        const workOrder = await SELECT.one.from(WorkOrders).where({ ID: WorkOrderID });
        if (!workOrder)
            return req.reject("Work order not found.");

        if (workOrder.status === "Closed")
            return req.reject("Work order is already closed.");

        if (workOrder.status !== "Completed")
            return req.reject(`Work order must be Completed before closing. Current status: ${workOrder.status}`);


        const operations = await SELECT.from(WorkOrderOperations).where({ workOrder_ID: WorkOrderID });
        if (!operations.length)
            return req.reject("Work order has no operations.");

        const pendingOperations = operations.filter(op => op.isMandatory && op.status !== "Completed");
        if (pendingOperations.length)
            return req.reject(`Mandatory operations not completed: ${pendingOperations.map(op => op.sequenceNumber).sort((a, b) => a - b).join(", ")}`);


        const confirmations = await SELECT.from(TimeConfirmations).where({ workOrder_ID: WorkOrderID });
        if (!confirmations.length)
            return req.reject("At least one time confirmation is required.");


        const estimatedCost = Number(workOrder.estimatedCost || 0);
        const actualCost = Number(workOrder.actualCost || 0);

        if (!Number.isFinite(estimatedCost) || !Number.isFinite(actualCost) || estimatedCost < 0 || actualCost < 0)
            return req.reject("Invalid work order cost.");

        if (workOrder.approvalStatus === "Pending")
            return req.reject("Manager approval is pending. Work order cannot be closed.");

        if (workOrder.approvalStatus === "Rejected")
            return req.reject("Work order was rejected by the manager. Rework is required.");

        const approvalRequired = estimatedCost > MANAGER_APPROVAL_LIMIT || actualCost > MANAGER_APPROVAL_LIMIT;

        if (approvalRequired && workOrder.approvalStatus !== "Approved")
            return req.reject("Manager approval is required before closing this work order.");


        const equipment = await SELECT.one.from(Equipment).where({ ID: workOrder.equipment_ID });
        if (!equipment)
            return req.reject("Associated equipment not found.");


        await UPDATE(WorkOrders)
            .set({
                status: "Closed",
                closedBy: req.user.id,
                closedAt: new Date().toISOString()
            })
            .where({ ID: WorkOrderID });


        if (workOrder.orderType === "Preventive" && workOrder.maintenancePlan_ID) {
            const plan = await SELECT.one.from(MaintenancePlans).where({ ID: workOrder.maintenancePlan_ID });

            if (plan && plan.triggerType === "Calendar") {
                const lastDate = new Date(workOrder.actualEndDate || new Date());
                const nextDate = new Date(lastDate);
                nextDate.setUTCDate(nextDate.getUTCDate() + Number(plan.intervalValue));

                await UPDATE(MaintenancePlans)
                    .set({
                        lastMaintenanceDate: lastDate.toISOString().slice(0, 10),
                        nextDueDate: nextDate.toISOString().slice(0, 10)
                    })
                    .where({ ID: plan.ID });
            }
            else if (plan && plan.triggerType === "Meter") {
                const lastReading = Number(equipment.currentReading || 0);

                await UPDATE(MaintenancePlans)
                    .set({
                        lastMaintenanceReading: lastReading,
                        nextDueReading: lastReading + Number(plan.intervalValue)
                    })
                    .where({ ID: plan.ID });
            }
        }

        // 9. Return updated work order
        return await SELECT.one.from(WorkOrders).where({ ID: WorkOrderID });
    });

    // action for consume part
    this.on("consumePart", async (req) => {
        const { WorkOrderID, OperationID, SparePartID, TechnicianID, quantity } = req.data;

        // 1. Required inputs
        if (!WorkOrderID || !OperationID || !SparePartID || !TechnicianID || quantity === undefined || quantity === null)
            return req.reject(400, "Work order, operation, spare part, technician and quantity are required");

        // 2. Quantity
        const qty = Number(quantity);
        if (!Number.isFinite(qty) || qty <= 0)
            return req.reject("Quantity must be a valid number greater than zero");
        if (Number(qty.toFixed(3)) !== qty)
            return req.reject("Quantity cannot have more than 3 decimal places");

        // 3. Work order
        const workOrder = await SELECT.one.from(WorkOrders).where({ ID: WorkOrderID });
        if (!workOrder) return req.reject("Work order not found");
        if (!["Released", "InProgress"].includes(workOrder.status))
            return req.reject(`Parts can only be consumed when the work order is Released or InProgress. Current status: ${workOrder.status}`);

        // 4. Operation belongs to the work order
        const operation = await SELECT.one.from(WorkOrderOperations).where({ ID: OperationID, workOrder_ID: WorkOrderID });
        if (!operation) return req.reject("Operation not found for this work order");

        // 5. Technician
        const technician = await SELECT.one.from(Technicians).where({ ID: TechnicianID });
        if (!technician) return req.reject("Technician not found");
        if (technician.isActive !== true) return req.reject("Technician is inactive");

        const assignment = await SELECT.one.from(TechnicianAssignments).where({ workOrder_ID: WorkOrderID, technician_ID: TechnicianID });
        if (!assignment) return req.reject("Technician is not assigned to this work order");

        // 6. Spare part, cost and stock
        const sparePart = await SELECT.one.from(SpareParts).where({ ID: SparePartID });
        if (!sparePart) return req.reject("Spare part not found");

        const unitCost = Number(sparePart.standardCost || 0);
        if (!Number.isFinite(unitCost) || unitCost < 0)
            return req.reject("Invalid spare part standard cost");

        const availableStock = Number(sparePart.stockQuantity || 0);
        if (!Number.isFinite(availableStock) || availableStock < qty)
            return req.reject(`Insufficient stock for ${sparePart.partNumber}. Available: ${availableStock}, requested: ${qty}`);

        // 7. Deduct stock only when enough is still available
        const updated = await UPDATE(SpareParts)
            .set({ stockQuantity: { "-=": qty } })
            .where({ ID: SparePartID, stockQuantity: { ">=": qty } });
        if (!updated)
            return req.reject(`Insufficient stock for ${sparePart.partNumber}`);

        // 8. Save the consumption
        const totalCost = Number((qty * unitCost).toFixed(2));
        const ID = cds.utils.uuid();

        await INSERT.into(PartConsumptions).entries({
            ID,
            workOrder_ID: WorkOrderID,
            operation_ID: OperationID,
            sparePart_ID: SparePartID,
            quantity: qty,
            unitCost,
            totalCost,
            consumedAt: new Date().toISOString()
        });

        // 9. Update the work order's running cost
        const consumptions = await SELECT.from(PartConsumptions).columns("totalCost").where({ workOrder_ID: WorkOrderID });

        const actualCost = Number(consumptions.reduce((total, item) => total + Number(item.totalCost || 0), 0).toFixed(2));

        await UPDATE(WorkOrders).set({ actualCost: Number(actualCost.toFixed(2)) }).where({ ID: WorkOrderID });

        // 10. Return the new consumption
        return await SELECT.one.from(PartConsumptions).where({ ID });
    });


    // action for conver to work order
    this.on("convertToWorkOrder", async (req) => {
        const { RequestID, orderType, category, plannedStartDate, plannedEndDate, operations } = req.data;

        if (!RequestID || !orderType || !category || !plannedStartDate || !plannedEndDate)
            return req.reject("All mandatory fields must be provided.");

        if (!["Breakdown", "Corrective"].includes(orderType))
            return req.reject("Invalid work order type.");

        if (!["Mechanical", "Electrical", "Instrumentation", "Other"].includes(category))
            return req.reject("Invalid maintenance category.");

        const startDate = new Date(plannedStartDate);
        const endDate = new Date(plannedEndDate);

        if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()))
            return req.reject("Invalid planned start or end date.");

        if (endDate <= startDate)
            return req.reject("Planned end date must be after planned start date.");

        // 5. Operations
        if (!Array.isArray(operations) || operations.length === 0)
            return req.reject("At least one work order operation is required.");

        let plannedHours = 0;
        const newOperations = [];

        for (const [index, operation] of operations.entries()) {
            if (typeof operation.operationName !== "string" || !operation.operationName.trim())
                return req.reject(`Operation name is required for operation ${index + 1}.`);

            const hours = Number(operation.plannedHours);

            if (!Number.isFinite(hours) || hours <= 0)
                return req.reject(`Planned hours must be greater than zero for operation ${index + 1}.`);

            if (Number(hours.toFixed(2)) !== hours)
                return req.reject(`Planned hours can have a maximum of two decimal places for operation ${index + 1}.`);

            if (typeof operation.isMandatory !== "boolean")
                return req.reject(`isMandatory must be true or false for operation ${index + 1}.`);

            plannedHours += hours;

            newOperations.push({
                ID: cds.utils.uuid(),
                sequenceNumber: (index + 1) * 10,
                operationName: operation.operationName.trim(),
                plannedHours: hours,
                actualHours: 0,
                isMandatory: operation.isMandatory,
                status: "Pending"
            });
        }

        // 6. Maintenance request
        const maintenanceRequest = await SELECT.one.from(MaintenanceRequests).where({ ID: RequestID });
        if (!maintenanceRequest)
            return req.reject("Maintenance request not found.");

        // 7. Request status
        if (!["Submitted", "UnderReview"].includes(maintenanceRequest.status))
            return req.reject(`Cannot convert maintenance request with status ${maintenanceRequest.status}.`);

        // 8. Equipment
        if (!maintenanceRequest.equipment_ID)
            return req.reject("Maintenance request is not associated with equipment.");

        // 9. Duplicate work order
        const existingOrder = await SELECT.one.from(WorkOrders).where({ maintenanceRequest_ID: RequestID });
        if (existingOrder)
            return req.reject(`Work order ${existingOrder.orderNumber} already exists for this maintenance request.`);

        // 10. Next work order number
        const existingOrders = await SELECT.from(WorkOrders).columns("orderNumber");

        let maxNumber = 0;
        for (const order of existingOrders) {
            const match = /^WO-(\d+)$/.exec(order.orderNumber || "");
            if (match) maxNumber = Math.max(maxNumber, Number(match[1]));
        }

        const orderNumber = `WO-${String(maxNumber + 1).padStart(4, "0")}`;

        // 11. Create work order
        const workOrderID = cds.utils.uuid();

        await INSERT.into(WorkOrders).entries({
            ID: workOrderID,
            orderNumber,
            orderType,
            title: maintenanceRequest.symptom,
            description: maintenanceRequest.description,
            priority: maintenanceRequest.priority,
            priorityScore: maintenanceRequest.priorityScore,
            status: "Planned",
            plannedStartDate: startDate.toISOString(),
            plannedEndDate: endDate.toISOString(),
            plannedHours: Number(plannedHours.toFixed(2)),
            approvalStatus: "NotRequired",
            equipment_ID: maintenanceRequest.equipment_ID,
            maintenanceRequest_ID: maintenanceRequest.ID
        });

        // 12. Create operations
        const operationEntries = newOperations.map(operation => ({ ...operation, workOrder_ID: workOrderID }));
        await INSERT.into(WorkOrderOperations).entries(operationEntries);

        // 13. Downtime event for breakdown orders
        if (orderType === "Breakdown") {
            await INSERT.into(DowntimeEvents).entries({
                ID: cds.utils.uuid(),
                equipment_ID: maintenanceRequest.equipment_ID,
                workOrder_ID: workOrderID,
                startTime: maintenanceRequest.reportedAt || new Date().toISOString(),
                reason: maintenanceRequest.symptom,
                isPlanned: false
            });
        }

        // 14. Update the maintenance request
        await UPDATE(MaintenanceRequests)
            .set({ status: "Converted", workOrder_ID: workOrderID, category })
            .where({ ID: RequestID });

        // 15. Return the new work order
        return await SELECT.one.from(WorkOrders).where({ ID: workOrderID });
    });


    const MANAGER_APPROVAL_LIMIT = 100000;

    function requiresManagerApproval(workOrder) {
        const estimatedCost = Number(workOrder.estimatedCost || 0);
        const actualCost = Number(workOrder.actualCost || 0);

        return (
            estimatedCost > MANAGER_APPROVAL_LIMIT ||
            actualCost > MANAGER_APPROVAL_LIMIT
        );
    }


    // APPROVE WORK ORDER
    this.on("approveWorkOrder", async (req) => {
        const { WorkOrderID, remarks } = req.data;

        if (!WorkOrderID)
            return req.reject("WorkOrderID is required.");

        if (!remarks || !remarks.trim())
            return req.reject("Approval remarks are required.");

        if (!req.user.is("MaintenanceManager"))
            return req.reject("Only Maintenance Managers can approve work orders.");

        const workOrder = await SELECT.one
            .from(WorkOrders)
            .where({ ID: WorkOrderID });

        if (!workOrder)
            return req.reject("Work order not found.");

        if (workOrder.status !== "Completed")
            return req.reject("Only completed work orders can be approved.");

        if (workOrder.approvalStatus !== "Pending")
            return req.reject("Work order is not awaiting approval.");

        if (!requiresManagerApproval(workOrder))
            return req.reject("This work order does not meet the manager approval threshold.");

        await UPDATE(WorkOrders)
            .set({
                approvalStatus: "Approved",
                approvedBy: req.user.id,
                approvalAt: new Date().toISOString(),
                approvalRemarks: remarks.trim()
            })
            .where({ ID: WorkOrderID });

        return await SELECT.one
            .from(WorkOrders)
            .where({ ID: WorkOrderID });
    });


    // REJECT WORK ORDER
    this.on("rejectWorkOrder", async (req) => {
        const { WorkOrderID, remarks } = req.data;

        if (!WorkOrderID)
            return req.reject("WorkOrderID is required.");

        if (!remarks || !remarks.trim())
            return req.reject("Rejection remarks are required.");

        if (!req.user.is("MaintenanceManager"))
            return req.reject("Only Maintenance Managers can reject work orders.");

        const workOrder = await SELECT.one
            .from(WorkOrders)
            .where({ ID: WorkOrderID });

        if (!workOrder)
            return req.reject("Work order not found.");

        if (workOrder.status !== "Completed")
            return req.reject("Only completed work orders can be rejected.");

        if (workOrder.approvalStatus !== "Pending")
            return req.reject("Work order is not awaiting approval.");

        if (!requiresManagerApproval(workOrder))
            return req.reject("This work order does not meet the manager approval threshold.");

        await UPDATE(WorkOrders)
            .set({
                status: "InProgress",
                approvalStatus: "Rejected",
                approvedBy: req.user.id,
                approvalAt: new Date().toISOString(),
                approvalRemarks: remarks.trim()
            })
            .where({ ID: WorkOrderID });

        return await SELECT.one
            .from(WorkOrders)
            .where({ ID: WorkOrderID });
    });

    // before validation

    const isValidDate = value =>
        value !== null &&
        value !== undefined &&
        !Number.isNaN(new Date(value).getTime());

    const isPositiveNumber = value =>
        Number.isFinite(Number(value)) && Number(value) > 0;

    const isNonNegativeNumber = value =>
        Number.isFinite(Number(value)) && Number(value) >= 0;

    const hasField = (data, field) =>
        Object.prototype.hasOwnProperty.call(data, field);

    const getRecordID = req =>
        req.data.ID || req.params?.[0]?.ID;

    async function getExistingRecord(entity, req) {
        const ID = getRecordID(req);

        if (!ID) {
            return req.reject("Record ID is required for update.");
        }

        const record = await SELECT.one.from(entity).where({ ID });

        if (!record) {
            return req.reject("Record not found.");
        }

        return record;
    }

    async function getMergedData(entity, req) {
        if (req.event === "CREATE") {
            return req.data;
        }

        const existing = await getExistingRecord(entity, req);
        return { ...existing, ...req.data };
    }

    async function validateEquipment(equipmentID, req) {
        if (!equipmentID) {
            return req.reject("Equipment is required.");
        }

        const equipment = await SELECT.one.from(Equipment)
            .where({ ID: equipmentID });

        if (!equipment) {
            return req.reject("Equipment not found.");
        }

        return equipment;
    }

    function requireRole(req, role) {
        if (!req.user?.is?.(role)) {
            return req.reject(`Only users with the ${role} role can perform this operation.`);
        }
    }


    // 1. EQUIPMENT

    this.before(["CREATE", "UPDATE"], "Equipment", async req => {
        const data = await getMergedData(Equipment, req);

        if (!data.equipmentCode?.trim()) {
            return req.reject("Equipment code is required.");
        }

        if (!data.equipmentName?.trim()) {
            return req.reject("Equipment name is required.");
        }

        if (
            data.criticality !== undefined &&
            !["Low", "Medium", "High", "Critical"].includes(data.criticality)
        ) {
            return req.reject("Invalid equipment criticality.");
        }

        if (
            data.currentReading !== null &&
            data.currentReading !== undefined &&
            !isNonNegativeNumber(data.currentReading)
        ) {
            return req.reject("Equipment current reading cannot be negative.");
        }

        if (data.location_ID) {
            const location = await SELECT.one.from(EquipmentLocations)
                .where({ ID: data.location_ID });

            if (!location) {
                return req.reject("Equipment location not found.");
            }
        }

        if (req.event === "UPDATE" && hasField(req.data, "currentReading")) {
            const existing = await getExistingRecord(Equipment, req);

            if (
                Number(data.currentReading) <
                Number(existing.currentReading || 0)
            ) {
                return req.reject(
                    "Equipment current reading cannot be lower than its existing reading."
                );
            }

            const latestReading = await SELECT.one.from(EquipmentReadings)
                .where({ equipment_ID: getRecordID(req) })
                .orderBy({ readingDate: "desc" });

            if (
                latestReading &&
                Number(data.currentReading) < Number(latestReading.readingValue)
            ) {
                return req.reject(
                    "Equipment current reading cannot be lower than its latest recorded reading."
                );
            }

            return req.reject(
                "Equipment current reading must be updated through confirmOperation."
            );
        }
    });


    // 2. MAINTENANCE PLANS

    this.before(["CREATE", "UPDATE"], "MaintenancePlans", async req => {
        const data = await getMergedData(MaintenancePlans, req);

        if (!data.planCode?.trim()) {
            return req.reject("Maintenance plan code is required.");
        }

        if (!data.planName?.trim()) {
            return req.reject("Maintenance plan name is required.");
        }

        if (!data.equipment_ID) {
            return req.reject("Equipment is required for a maintenance plan.");
        }

        await validateEquipment(data.equipment_ID, req);

        if (!["Calendar", "Meter"].includes(data.triggerType)) {
            return req.reject("Trigger type must be Calendar or Meter.");
        }

        if (!isPositiveNumber(data.intervalValue)) {
            return req.reject("Maintenance interval must be greater than zero.");
        }

        if (
            data.triggerType === "Calendar" &&
            !Number.isInteger(Number(data.intervalValue))
        ) {
            return req.reject("Calendar interval must be a whole number of days.");
        }

        if (
            data.leadDays !== null &&
            data.leadDays !== undefined &&
            (!Number.isInteger(Number(data.leadDays)) || Number(data.leadDays) < 0)
        ) {
            return req.reject("Lead days must be a non-negative whole number.");
        }

        if (
            data.isActive !== null &&
            data.isActive !== undefined &&
            typeof data.isActive !== "boolean"
        ) {
            return req.reject("isActive must be true or false.");
        }

        if (data.lastMaintenanceDate && !isValidDate(data.lastMaintenanceDate)) {
            return req.reject("Invalid last maintenance date.");
        }

        if (data.nextDueDate && !isValidDate(data.nextDueDate)) {
            return req.reject("Invalid next due date.");
        }

        if (
            data.lastMaintenanceReading !== null &&
            data.lastMaintenanceReading !== undefined &&
            !isNonNegativeNumber(data.lastMaintenanceReading)
        ) {
            return req.reject("Last maintenance reading cannot be negative.");
        }

        if (
            data.nextDueReading !== null &&
            data.nextDueReading !== undefined &&
            !isNonNegativeNumber(data.nextDueReading)
        ) {
            return req.reject("Next due reading cannot be negative.");
        }

        if (
            data.triggerType === "Calendar" &&
            data.nextDueDate &&
            data.lastMaintenanceDate &&
            new Date(data.nextDueDate) < new Date(data.lastMaintenanceDate)
        ) {
            return req.reject("Next due date cannot be before last maintenance date.");
        }

        if (
            data.triggerType === "Meter" &&
            data.nextDueReading !== null &&
            data.nextDueReading !== undefined &&
            data.lastMaintenanceReading !== null &&
            data.lastMaintenanceReading !== undefined &&
            Number(data.nextDueReading) <= Number(data.lastMaintenanceReading)
        ) {
            return req.reject(
                "Next due reading must be greater than last maintenance reading."
            );
        }
    });


    // 3. MAINTENANCE REQUESTS

    this.before(["CREATE", "UPDATE"], "MaintenanceRequests", async req => {
        const data = await getMergedData(MaintenanceRequests, req);

        if (!data.symptom?.trim()) {
            return req.reject("Breakdown symptom is required.");
        }

        if (!data.description?.trim()) {
            return req.reject("Breakdown description is required.");
        }

        if (!data.reportedBy?.trim()) {
            return req.reject("Reported by is required.");
        }

        if (!data.equipment_ID) {
            return req.reject("Equipment is required for a maintenance request.");
        }

        await validateEquipment(data.equipment_ID, req);

        if (
            !["Low", "Medium", "High", "Critical"].includes(data.requestedPriority)
        ) {
            return req.reject("Invalid requested priority.");
        }

        if (!["None", "Low", "Medium", "High"].includes(data.safetyImpact)) {
            return req.reject("Invalid safety impact.");
        }

        if (!["None", "Low", "Medium", "High"].includes(data.productionImpact)) {
            return req.reject("Invalid production impact.");
        }

        if (
            !["Mechanical", "Electrical", "Instrumentation", "Other"].includes(data.category)
        ) {
            return req.reject("Invalid maintenance request category.");
        }

        if (req.event === "CREATE") {
            if (data.status && data.status !== "Submitted") {
                return req.reject(
                    "New maintenance requests must have Submitted status."
                );
            }
        }

        if (req.event === "UPDATE" && hasField(req.data, "status")) {
            const existing = await getExistingRecord(MaintenanceRequests, req);

            if (["Converted", "Rejected"].includes(existing.status)) {
                return req.reject(
                    "Converted or rejected requests cannot be modified."
                );
            }

            if (data.status !== "UnderReview") {
                return req.reject(
                    "Request status can only be changed to UnderReview directly. Use the appropriate workflow for other status changes."
                );
            }

            if (existing.status !== "Submitted") {
                return req.reject(
                    "Only Submitted requests can be moved to UnderReview."
                );
            }

            requireRole(req, "MaintenancePlanner");
        }
    });


    // 4. WORK ORDERS

    this.before(["CREATE", "UPDATE"], "WorkOrders", async req => {
        const data = await getMergedData(WorkOrders, req);

        if (!["Breakdown", "Corrective", "Preventive"].includes(data.orderType)) {
            return req.reject("Invalid work order type.");
        }

        if (!data.title?.trim()) {
            return req.reject("Work order title is required.");
        }

        if (!data.equipment_ID) {
            return req.reject("Equipment is required for a work order.");
        }

        await validateEquipment(data.equipment_ID, req);

        if (!["Low", "Medium", "High", "Critical"].includes(data.priority)) {
            return req.reject("Invalid work order priority.");
        }

        if (
            data.priorityScore !== null &&
            data.priorityScore !== undefined &&
            !isNonNegativeNumber(data.priorityScore)
        ) {
            return req.reject("Priority score cannot be negative.");
        }

        if (data.plannedStartDate && !isValidDate(data.plannedStartDate)) {
            return req.reject("Invalid planned start date.");
        }

        if (data.plannedEndDate && !isValidDate(data.plannedEndDate)) {
            return req.reject("Invalid planned end date.");
        }

        if (
            data.plannedStartDate &&
            data.plannedEndDate &&
            new Date(data.plannedEndDate) <= new Date(data.plannedStartDate)
        ) {
            return req.reject("Planned end date must be after planned start date.");
        }

        for (const field of [
            "plannedHours",
            "actualHours",
            "estimatedCost",
            "actualCost"
        ]) {
            if (
                data[field] !== null &&
                data[field] !== undefined &&
                !isNonNegativeNumber(data[field])
            ) {
                return req.reject(`${field} cannot be negative.`);
            }
        }

        if (
            data.approvalStatus &&
            !["NotRequired", "Pending", "Approved", "Rejected"].includes(data.approvalStatus)
        ) {
            return req.reject("Invalid work order approval status.");
        }

        if (req.event === "CREATE") {
            if (data.status && data.status !== "Created") {
                return req.reject(
                    "Work orders must be created with Created status."
                );
            }

            if (data.approvalStatus && data.approvalStatus !== "NotRequired") {
                return req.reject(
                    "Approval status cannot be set during direct work order creation."
                );
            }

            const protectedCreateFields = [
                "approvedBy",
                "approvalAt",
                "approvalRemarks",
                "actualStartDate",
                "actualEndDate",
                "closedBy",
                "closedAt",
                "completedBy",
                "completionRemarks",
                "closureCode"
            ];

            const suppliedField = protectedCreateFields.find(field =>
                hasField(req.data, field)
            );

            if (suppliedField) {
                return req.reject(
                    `Cannot set ${suppliedField} during work order creation.`
                );
            }

            for (const field of ["actualHours", "actualCost"]) {
                if (Number(data[field] || 0) !== 0) {
                    return req.reject(
                        `${field} must be zero during work order creation.`
                    );
                }
            }
        }

        if (req.event === "UPDATE") {
            const protectedFields = [
                "status",
                "approvalStatus",
                "approvedBy",
                "approvalAt",
                "approvalRemarks",
                "actualStartDate",
                "actualEndDate",
                "actualHours",
                "actualCost",
                "closureCode",
                "completionRemarks",
                "completedBy",
                "closedBy",
                "closedAt"
            ];

            const changedProtectedField = protectedFields.find(field =>
                hasField(req.data, field)
            );

            if (changedProtectedField) {
                return req.reject(
                    `Direct modification of ${changedProtectedField} is not allowed. Use the corresponding work order action.`
                );
            }

            if (
                hasField(req.data, "plannedStartDate") ||
                hasField(req.data, "plannedEndDate")
            ) {
                requireRole(req, "MaintenancePlanner");
            }

            const existing = await getExistingRecord(WorkOrders, req);

            if (["Completed", "Closed"].includes(existing.status)) {
                return req.reject(
                    "Completed or closed work orders cannot be modified."
                );
            }
        }
    });


    // 5. WORK ORDER OPERATIONS

    this.before(["CREATE", "UPDATE"], "WorkOrderOperations", async req => {
        const data = await getMergedData(WorkOrderOperations, req);

        if (!data.workOrder_ID) {
            return req.reject("Work order is required for an operation.");
        }

        const workOrder = await SELECT.one.from(WorkOrders)
            .where({ ID: data.workOrder_ID });

        if (!workOrder) {
            return req.reject("Work order not found.");
        }

        if (!data.operationName?.trim()) {
            return req.reject("Operation name is required.");
        }

        if (
            !Number.isInteger(Number(data.sequenceNumber)) ||
            Number(data.sequenceNumber) <= 0
        ) {
            return req.reject(
                "Operation sequence number must be a positive whole number."
            );
        }

        if (!isPositiveNumber(data.plannedHours)) {
            return req.reject("Planned operation hours must be greater than zero.");
        }

        if (
            data.actualHours !== null &&
            data.actualHours !== undefined &&
            !isNonNegativeNumber(data.actualHours)
        ) {
            return req.reject("Actual operation hours cannot be negative.");
        }

        if (
            data.isMandatory !== null &&
            data.isMandatory !== undefined &&
            typeof data.isMandatory !== "boolean"
        ) {
            return req.reject("isMandatory must be true or false.");
        }

        if (
            data.status &&
            !["Pending", "InProgress", "Completed"].includes(data.status)
        ) {
            return req.reject("Invalid operation status.");
        }

        const duplicateOperations = await SELECT.from(WorkOrderOperations)
            .where({
                workOrder_ID: data.workOrder_ID,
                sequenceNumber: data.sequenceNumber
            });

        if (duplicateOperations.some(operation =>
            operation.ID !== getRecordID(req)
        )) {
            return req.reject(
                "Operation sequence number already exists for this work order."
            );
        }

        if (req.event === "CREATE") {
            if (data.status && data.status !== "Pending") {
                return req.reject(
                    "New operations must have Pending status."
                );
            }

            if (Number(data.actualHours || 0) !== 0) {
                return req.reject(
                    "Actual operation hours must be zero during creation."
                );
            }
        }

        if (req.event === "UPDATE") {
            if (
                hasField(req.data, "status") ||
                hasField(req.data, "actualHours")
            ) {
                return req.reject(
                    "Operation status and actual hours must be updated through confirmOperation."
                );
            }

            const existing = await getExistingRecord(WorkOrderOperations, req);

            if (existing.status === "Completed") {
                return req.reject("Completed operations cannot be modified.");
            }
        }

        if (!["Created", "Planned", "Assigned"].includes(workOrder.status)) {
            return req.reject(
                "Operations cannot be added or modified after work order release."
            );
        }
    });


    // 6. TECHNICIAN ASSIGNMENTS

    this.before(["CREATE", "UPDATE"], "TechnicianAssignments", async req => {
        requireRole(req, "MaintenancePlanner");

        const data = await getMergedData(TechnicianAssignments, req);

        if (!data.workOrder_ID || !data.technician_ID) {
            return req.reject("Work order and technician are required.");
        }

        const workOrder = await SELECT.one.from(WorkOrders)
            .where({ ID: data.workOrder_ID });

        if (!workOrder) {
            return req.reject("Work order not found.");
        }

        if (!["Created", "Planned", "Assigned"].includes(workOrder.status)) {
            return req.reject(
                "Technicians can only be assigned before work order release."
            );
        }

        const technician = await SELECT.one.from(Technicians)
            .where({ ID: data.technician_ID });

        if (!technician) {
            return req.reject("Technician not found.");
        }

        if (technician.isActive !== true) {
            return req.reject("Inactive technicians cannot be assigned.");
        }

        if (typeof data.isLead !== "boolean") {
            return req.reject("isLead must be true or false.");
        }

        if (
            data.technicianUserId &&
            data.technicianUserId !== technician.userId
        ) {
            return req.reject(
                "Technician user ID must match the selected technician."
            );
        }

        const existingAssignments = await SELECT.from(TechnicianAssignments)
            .where({ workOrder_ID: data.workOrder_ID });

        if (existingAssignments.some(assignment =>
            assignment.technician_ID === data.technician_ID &&
            assignment.ID !== getRecordID(req)
        )) {
            return req.reject(
                "Technician is already assigned to this work order."
            );
        }

        if (
            data.isLead &&
            existingAssignments.some(assignment =>
                assignment.isLead === true &&
                assignment.ID !== getRecordID(req)
            )
        ) {
            return req.reject(
                "A lead technician is already assigned to this work order."
            );
        }
    });


    // 7. TIME CONFIRMATIONS

    this.before(["CREATE", "UPDATE"], "TimeConfirmations", req => {
        return req.reject(
            "Time confirmations must be recorded through the confirmOperation action."
        );
    });


    // 8. SPARE PARTS

    this.before(["CREATE", "UPDATE"], "SpareParts", async req => {
        const data = await getMergedData(SpareParts, req);

        if (!data.partNumber?.trim()) {
            return req.reject("Spare part number is required.");
        }

        if (!data.partName?.trim()) {
            return req.reject("Spare part name is required.");
        }

        if (!isNonNegativeNumber(data.standardCost)) {
            return req.reject("Spare part standard cost cannot be negative.");
        }

        if (!isNonNegativeNumber(data.stockQuantity)) {
            return req.reject("Spare part stock quantity cannot be negative.");
        }

        if (req.event === "UPDATE" && hasField(req.data, "stockQuantity")) {
            return req.reject(
                "Stock quantity must be changed through an authorized stock adjustment process."
            );
        }
    });


    // 9. PART CONSUMPTIONS

    this.before(["CREATE", "UPDATE"], "PartConsumptions", req => {
        return req.reject(
            "Part consumption records must be created through the consumePart action and cannot be modified directly."
        );
    });


    // 10. EQUIPMENT READINGS

    this.before(["CREATE", "UPDATE"], "EquipmentReadings", req => {
        return req.reject(
            "Equipment readings must be recorded through the confirmOperation action and cannot be modified directly."
        );
    });


    // 11. MAINTENANCE DOCUMENTS

    this.before(["CREATE", "UPDATE"], "MaintenanceDocuments", async req => {
        const data = await getMergedData(MaintenanceDocuments, req);

        if (!data.fileName?.trim()) {
            return req.reject("Document file name is required.");
        }

        if (!data.mimeType?.trim()) {
            return req.reject("Document MIME type is required.");
        }

        const mimeType = data.mimeType.toLowerCase();

        const allowedMimeTypes = [
            "image/jpeg",
            "image/png",
            "image/webp",
            "application/pdf"
        ];

        if (!allowedMimeTypes.includes(mimeType)) {
            return req.reject("Unsupported document format.");
        }

        if (!["Photo", "Manual", "Report"].includes(data.documentType)) {
            return req.reject("Invalid document type.");
        }

        if (
            data.documentType === "Photo" &&
            !["image/jpeg", "image/png", "image/webp"].includes(mimeType)
        ) {
            return req.reject(
                "Photo documents must be JPEG, PNG or WEBP."
            );
        }

        if (
            data.documentType !== "Photo" &&
            mimeType.startsWith("image/")
        ) {
            return req.reject(
                "Image files must use the Photo document type."
            );
        }

        if (!data.content) {
            return req.reject("Document content is required.");
        }

        let contentSize;

        if (Buffer.isBuffer(data.content)) {
            contentSize = data.content.length;
        } else if (typeof data.content === "string") {
            try {
                contentSize = Buffer.from(data.content, "base64").length;
            } catch {
                return req.reject("Invalid document content encoding.");
            }
        } else {
            return req.reject("Invalid document content.");
        }

        if (!Number.isInteger(Number(data.fileSize)) || Number(data.fileSize) <= 0) {
            return req.reject("Document file size must be a positive whole number.");
        }

        if (contentSize !== Number(data.fileSize)) {
            return req.reject(
                "Document file size does not match the uploaded content."
            );
        }

        if (contentSize > 5 * 1024 * 1024) {
            return req.reject("Document size cannot exceed 5 MB.");
        }

        if (data.equipment_ID) {
            await validateEquipment(data.equipment_ID, req);
        }

        if (data.maintenanceRequest_ID) {
            const request = await SELECT.one.from(MaintenanceRequests)
                .where({ ID: data.maintenanceRequest_ID });

            if (!request) {
                return req.reject("Maintenance request for document not found.");
            }
        }

        if (data.workOrder_ID) {
            const workOrder = await SELECT.one.from(WorkOrders)
                .where({ ID: data.workOrder_ID });

            if (!workOrder) {
                return req.reject("Work order for document not found.");
            }
        }

        if (
            !data.equipment_ID &&
            !data.maintenanceRequest_ID &&
            !data.workOrder_ID
        ) {
            return req.reject(
                "Document must be linked to equipment, maintenance request or work order."
            );
        }

        if (req.event === "UPDATE") {
            return req.reject(
                "Uploaded maintenance documents cannot be modified. Upload a new document instead."
            );
        }
    });


    // 12. DOWNTIME EVENTS

    this.before(["CREATE", "UPDATE"], "DowntimeEvents", async req => {
        const data = await getMergedData(DowntimeEvents, req);

        if (!data.equipment_ID) {
            return req.reject("Equipment is required for a downtime event.");
        }

        await validateEquipment(data.equipment_ID, req);

        if (!data.reason?.trim()) {
            return req.reject("Downtime reason is required.");
        }

        if (!isValidDate(data.startTime)) {
            return req.reject("Valid downtime start time is required.");
        }

        if (data.endTime) {
            if (!isValidDate(data.endTime)) {
                return req.reject("Invalid downtime end time.");
            }

            if (new Date(data.endTime) < new Date(data.startTime)) {
                return req.reject(
                    "Downtime end time cannot be before start time."
                );
            }
        }

        if (
            data.durationMinutes !== null &&
            data.durationMinutes !== undefined &&
            (
                !Number.isInteger(Number(data.durationMinutes)) ||
                Number(data.durationMinutes) < 0
            )
        ) {
            return req.reject(
                "Downtime duration must be a non-negative whole number."
            );
        }

        if (typeof data.isPlanned !== "boolean") {
            return req.reject("isPlanned must be true or false.");
        }

        if (data.workOrder_ID) {
            const workOrder = await SELECT.one.from(WorkOrders)
                .where({ ID: data.workOrder_ID });

            if (!workOrder) {
                return req.reject("Downtime work order not found.");
            }

            if (workOrder.equipment_ID !== data.equipment_ID) {
                return req.reject(
                    "Downtime equipment must match the work order equipment."
                );
            }
        }

        if (req.event === "UPDATE") {
            return req.reject(
                "Downtime records cannot be modified directly. Downtime closure is managed through the work order workflow."
            );
        }
    });


});



