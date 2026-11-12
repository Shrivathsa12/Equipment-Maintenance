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

        nt
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



});



