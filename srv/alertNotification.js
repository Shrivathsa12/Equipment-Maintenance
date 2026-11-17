const cds = require("@sap/cds");
const {
    AlertNotificationClient,
    OAuthAuthentication,
    RegionUtils,
    Severity,
    Category
} = require("@sap_oss/alert-notification-client");

let client = null;

// Created on first use, so the application still starts when Alert Notification is not configured (local development)
function getClient() {
    if (client) return client;

    // Bound service on BTP first, environment variables as a fallback
    const bound = cds.env.requires?.["alert-notification"]?.credentials || {};

    const username = bound.client_id || process.env.AN_CLIENT_ID;
    const password = bound.client_secret || process.env.AN_CLIENT_SECRET;
    const oAuthTokenUrl = bound.oauth_url ? `${bound.oauth_url}/oauth/token` : process.env.AN_OAUTH_URL;

    if (!username || !password || !oAuthTokenUrl) return null;

    const region = RegionUtils[process.env.AN_REGION || "US10"];
    if (!region) throw new Error(`Unknown AN_REGION ${process.env.AN_REGION}`);

    client = new AlertNotificationClient({
        authentication: new OAuthAuthentication({ username, password, oAuthTokenUrl }),
        region
    });

    return client;
}

// Sends one event. Returns false when Alert Notification is not configured, so callers can tell nothing was sent.
async function send(event) {
    const alertClient = getClient();

    if (!alertClient) {
        console.log(`[ALERT - not configured, not sent] ${event.eventType}: ${event.subject}`);
        return false;
    }

    await alertClient.sendEvent(event);
    return true;
}

async function sendCriticalBreakdownAlert(data) {
    return send({
        eventType: "EquipmentMaintenance.CriticalBreakdown",
        severity: Severity.FATAL,
        category: Category.ALERT,
        subject: `Critical Breakdown - ${data.equipmentName}`,
        body:
            "CRITICAL EQUIPMENT BREAKDOWN\n" +
            "================================\n\n" +
            "A critical equipment breakdown has been reported.\n\n" +
            "Request Number : " + data.requestNumber + "\n" +
            "Equipment     : " + data.equipmentName + "\n" +
            "Equipment Code: " + data.equipmentCode + "\n" +
            "Priority      : " + data.priority + "\n" +
            "Symptom       : " + data.symptom + "\n" +
            "Description   : " + data.description + "\n\n" +
            "ACTION REQUIRED:\n" +
            "Please investigate this breakdown immediately.\n\n" +
            "Regards,\n" +
            "Equipment Maintenance System",
        resource: {
            resourceName: data.equipmentName,
            resourceType: "Equipment",
            resourceInstance: data.equipmentCode
        },
        eventTimestamp: Math.floor(Date.now() / 1000),
        priority: 1
    });
}

async function sendSLABreachAlert(data) {
    return send({
        eventType: "EquipmentMaintenance.SLABreach",
        severity: Severity.WARNING,
        category: Category.ALERT,
        subject: `SLA Breach - Work Order ${data.orderNumber}`,
        body:
            "WORK ORDER SLA BREACH\n" +
            "================================\n\n" +
            "A work order has exceeded its planned completion date.\n\n" +
            "Work Order Number: " + data.orderNumber + "\n" +
            "Equipment: " + data.equipmentName + "\n" +
            "Equipment Code: " + data.equipmentCode + "\n" +
            "Priority: " + data.priority + "\n" +
            "Status: " + data.status + "\n" +
            "Planned End Date: " + data.plannedEndDate + "\n\n" +
            "ACTION REQUIRED:\n" +
            "Please review and complete this overdue work order.\n\n" +
            "Regards,\n" +
            "Equipment Maintenance System",
        resource: {
            resourceName: data.equipmentName,
            resourceType: "Equipment",
            resourceInstance: data.equipmentCode
        },
        eventTimestamp: Math.floor(Date.now() / 1000),
        priority: 2
    });
}

module.exports = {
    sendCriticalBreakdownAlert, sendSLABreachAlert
};