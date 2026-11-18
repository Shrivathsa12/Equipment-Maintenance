
const cds = require("@sap/cds");

const {
    AlertNotificationClient,
    OAuthAuthentication,
    RegionUtils,
    Severity,
    Category
} = require("@sap_oss/alert-notification-client");

let client = null;

function getClient() {
    if (client) return client;

    // Read credentials from Cloud Foundry VCAP_SERVICES
    let vcapServices = {};

    try {
        vcapServices = JSON.parse(process.env.VCAP_SERVICES || "{}");
    } catch (error) {
        console.error("[ALERT] Unable to parse VCAP_SERVICES");
    }

    const alertBindings = vcapServices["alert-notification"] || [];

    const alertBinding = alertBindings.find(
        binding => binding.name === "equipment-alert"
    );

    // Cloud Foundry binding first, CAP configuration as fallback
    const bound =
        alertBinding?.credentials ||
        cds.env.requires?.["alert-notification"]?.credentials ||
        {};

    const username = bound.client_id || process.env.AN_CLIENT_ID;
    const password = bound.client_secret || process.env.AN_CLIENT_SECRET;

    // oauth_url already contains /oauth/token
    const oAuthTokenUrl = bound.oauth_url || process.env.AN_OAUTH_URL;

    if (!username || !password || !oAuthTokenUrl) {
        console.error("[ALERT] Missing Alert Notification credentials:", {
            clientId: !!username,
            clientSecret: !!password,
            oauthUrl: !!oAuthTokenUrl
        });
        return null;
    }

    const regionName = process.env.AN_REGION || "US10";
    const region = RegionUtils[regionName];

    if (!region) {
        throw new Error(`Unknown AN_REGION ${regionName}`);
    }

    client = new AlertNotificationClient({
        authentication: new OAuthAuthentication({
            username,
            password,
            oAuthTokenUrl
        }),
        region
    });

    console.log("[ALERT] Alert Notification client initialized successfully");

    return client;
}

async function send(event) {
    const alertClient = getClient();

    if (!alertClient) {
        console.log(
            `[ALERT - not configured, not sent] ${event.eventType}: ${event.subject}`
        );
        return false;
    }

    await alertClient.sendEvent(event);

    console.log(`[ALERT] Event sent successfully: ${event.eventType}`);

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
    sendCriticalBreakdownAlert,
    sendSLABreachAlert
};
