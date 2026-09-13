// ogRoutes.js
import express from "express";
import Neighborhood from "./structure/models/Neighborhood.js";

const router = express.Router();

const escapeHtml = (str = "") => {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
};

router.get("/api/og/join/:code", async (req, res) => {
  try {
    const neighborhood = await Neighborhood.findOne({
      "inviteLinks.code": req.params.code,
      "inviteLinks.isActive": true,
    }).populate("owner", "username profilePhoto");

    if (!neighborhood) {
      return res.status(404).send("Invite link not found");
    }

    const name = escapeHtml(neighborhood.name);
    const description = escapeHtml(
      neighborhood.description || "Join this bubble",
    );
    const memberCount = neighborhood.members.length;

    const imageUrl = neighborhood.bubblePhotoCid
      ? `https://${process.env.PINATA_GATEWAY}/ipfs/${neighborhood.bubblePhotoCid}`
      : "https://bubblebased.com/bbl.jpg";

    const ogUrl = `https://bubblebased.com/join/${req.params.code}`;

    res.set("Content-Type", "text/html; charset=utf-8");
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${name} — BubbleBased</title>

  <meta property="og:type" content="website" />
  <meta property="og:title" content="Join the ${name} bubble" />
  <meta property="og:description" content="${description} · ${memberCount} members" />
  <meta property="og:image" content="${imageUrl}" />
  <meta property="og:url" content="${ogUrl}" />
  <meta property="og:site_name" content="BubbleBased" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${name}" />
  <meta name="twitter:description" content="${description} · ${memberCount} members" />
  <meta name="twitter:image" content="${imageUrl}" />

  <meta http-equiv="refresh" content="0;url=${ogUrl}" />
</head>
<body>
  <p>Redirecting to <a href="${ogUrl}">${name}</a>...</p>
</body>
</html>`);
  } catch (error) {
    console.error("OG route error:", error);
    res.status(500).send("Server error");
  }
});

export default router;
