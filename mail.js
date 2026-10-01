const { Reservation, User, Restaurant } = require("../models");
const nodemailer = require("nodemailer");
const Mailgen = require("mailgen");

const { EMAIL_HOST, EMAIL_PASSWORD } = process.env;

//send mail from gmail
//    const UserEmailData = await User.findByPk();
const sendConfirmation = async (userEmail, reservation, restaurantData) => {
  const dateFormat = reservation.time.toLocaleDateString();
  const timeFormat = reservation.time.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  const uEmail = userEmail.email;
  let transporter = nodemailer.createTransport({
    host: "smtp.mailgun.org",
    port: 587,
    secure: true, // true for 465, false for other ports
    auth: {
      user: process.env.MAILGUN_SMTP_USER,
      pass: process.env.MAILGUN_SMTP_PASSWORD,
    },
  });

  var MailGenerator = new Mailgen({
    theme: "cerberus",
    product: {
      // Appears in header & footer of e-mails
      name: "ebubbl",
      link: "https://ebubbl.com",
      // Optional product logo
      // logo: 'https://mailgen.js/img/logo.png'
    },
  });

  var response = {
    body: {
      name: userEmail.name,
      intro: `Get ready for a great meal at ${restaurantData.name}`,
      action: {
        instructions: `Your reservation at ${restaurantData.name} is confirmed for a party of ${reservation.party_number} on ${dateFormat} at ${timeFormat}.`,
        button: {
          color: "#571313", // Optional action button color
          text: "ebubbl",
          link: "https://ebubbl.com/",
        },
      },
      outro: `${restaurantData.name}  ${restaurantData.phone}  ${restaurantData.address}  ${restaurantData.city}  ${restaurantData.state}`,
    },
  };
  let mail = MailGenerator.generate(response);
  var emailText = MailGenerator.generatePlaintext(response);

  let message = {
    from: EMAIL_HOST,
    to: uEmail, // list of receivers
    subject: "Your Reservation", // Subject line
    text: emailText, // plain text body
    html: mail, // html body
  };

  await transporter.sendMail(message);

  // res.status(201).json("Get Bill Sucessfully");
};
module.exports = {
  sendConfirmation,
};
