const { onRequest } = require("firebase-functions/v2/https");
const { RtcTokenBuilder, RtcRole } = require("agora-access-token");
const cors = require("cors")({ origin: true });

// NOTE: These should ideally be set in Firebase Config or Secrets, but for this demo/setup we can use placeholders or have the user provide them.
const APP_ID = process.env.AGORA_APP_ID || "REPLACE_WITH_YOUR_AGORA_APP_ID";
const APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE || "REPLACE_WITH_YOUR_AGORA_APP_CERT";

exports.generateAgoraToken = onRequest((req, res) => {
    cors(req, res, () => {
        const channelName = req.query.channel;
        if (!channelName) {
            return res.status(400).json({ error: "channel is required" });
        }

        const account = req.query.uid || "0"; 
        const role = RtcRole.PUBLISHER;

        let expireTime = req.query.expireTime;
        if (!expireTime || expireTime === '') {
            expireTime = 3600;
        } else {
            expireTime = parseInt(expireTime, 10);
        }

        const currentTime = Math.floor(Date.now() / 1000);
        const privilegeExpireTime = currentTime + expireTime;

        // Using user account for string UIDs
        const token = RtcTokenBuilder.buildTokenWithAccount(APP_ID, APP_CERTIFICATE, channelName, account, role, privilegeExpireTime);

        return res.json({ token });
    });
});
