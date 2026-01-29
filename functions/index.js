const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const { Resend } = require("resend");

admin.initializeApp();
const resend = new Resend("re_YOUR_KEY_HERE"); // Replace with your Resend API Key

exports.dailyFleetReport = onSchedule("0 6 * * *", async (event) => {
  const db = admin.firestore();
  
  // Pull all units that aren't "Active"
  const snapshot = await db.collection("buses")
    .where("status", "in", ["In Shop", "On Hold"])
    .get();

  if (snapshot.empty) {
    console.log("Yard is clear. No units in shop.");
    return;
  }

  const report = snapshot.docs.map(doc => {
    const bus = doc.data();
    return `• Unit #${bus.number}: ${bus.status} - ${bus.notes || 'No notes'}`;
  }).join("\n");

  await resend.emails.send({
    from: "MARTA Fleet <reports@yourdomain.com>",
    to: "anetowestfield@gmail.com", // Your admin email
    subject: `Daily Fleet Status: ${new Date().toLocaleDateString()}`,
    text: `Good morning, Superintendant. Current shop units:\n\n${report}`
  });
});