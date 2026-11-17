
require("dotenv").config();

const {
    AlertNotificationClient,
    OAuthAuthentication,
    RegionUtils,
    Severity,
    Category
} = require("@sap_oss/alert-notification-client");

const client = new AlertNotificationClient({
    authentication: new OAuthAuthentication({
        username: process.env.AN_CLIENT_ID,
        password: process.env.AN_CLIENT_SECRET,
        oAuthTokenUrl: process.env.AN_OAUTH_URL
    }),
    region: RegionUtils.US10
});

async function testAlert() {
    try {
        const response = await client.sendEvent({
            eventType: "EquipmentMaintenance.CriticalBreakdown",
            severity: Severity.FATAL,
            category: Category.ALERT,
            subject: "Test - Critical Equipment Breakdown",
            body: "Test alert from EquipmentMaintenance CAP application.",
            resource: {
                resourceName: "Hydraulic Press",
                resourceType: "Equipment",
                resourceInstance: "EQ-001"
            },
            eventTimestamp: Math.floor(Date.now() / 1000),
            priority: 1
        });

        console.log("Alert event sent successfully");
        console.log(response);

    } catch (error) {
        console.error("Alert Notification failed:");
        console.error(error.response?.data || error.message);
    }
}

testAlert();
