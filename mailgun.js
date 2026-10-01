import FormData from "form-data";
import Mailgun from "mailgun.js";
import dotenv from "dotenv";
import express from "express";

dotenv.config();

async function sendSimpleMessage() {
  const mailgun = new Mailgun(FormData);
  const mg = mailgun.client({
    username: "api",
    key: process.env.MG_API_KEY,
    // When you have an EU-domain, you must specify the endpoint:
    // url: "https://api.eu.mailgun.net"
  });
  try {
    const data = await mg.messages.create(
      "sandbox0af681eb70a64ce7be48ff05e93da4f2.mailgun.org",
      {
        from: "Mailgun Sandbox <postmaster@sandbox0af681eb70a64ce7be48ff05e93da4f2.mailgun.org>",
        to: ["Brian Ebel <bcebel@gmail.com>"],
        subject: "Hello Brian Ebel",
        text: "Congratulations Brian Ebel, you just sent an email with Mailgun! You are truly awesome!",
      },
    );

    console.log(data); // logs response data
  } catch (error) {
    console.log(error); //logs any error
  }
}

sendSimpleMessage();
