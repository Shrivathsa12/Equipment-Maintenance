
const {
    AlertNotificationClient,
    OAuthAuthentication,
    RegionUtils,
    Severity,
    Category
} = require("@sap_oss/alert-notification-client");

const authentication = new OAuthAuthentication({
    username: process.env.AN_CLIENT_ID,
    password: process.env.AN_CLIENT_SECRET,
    oAuthTokenUrl: process.env.AN_OAUTH_URL
});

const client = new AlertNotificationClient({
    authentication,
    region: RegionUtils.US10
});

async function sendCriticalBreakdownAlert(data) {
    const event = {
        eventType: "EquipmentMaintenance.CriticalBreakdown",
        severity: Severity.FATAL,
        category: Category.ALERT,
        subject: "Critical Equipment Breakdown",
        body:
            `Request Number: ${data.requestNumber}\n` +
            `Equipment: ${data.equipmentCode} - ${data.equipmentName}\n` +
            `Priority: ${data.priority}\n` +
            `Symptom: ${data.symptom}\n` +
            `Description: ${data.description}\n` +
            `Immediate maintenance attention required.`,
        resource: {
            resourceName: data.equipmentName,
            resourceType: "Equipment",
            resourceInstance: data.equipmentCode
        },
        eventTimestamp: Math.floor(Date.now() / 1000),
        priority: 1
    };

    return client.sendEvent(event);
}

module.exports = {
    sendCriticalBreakdownAlert
};
