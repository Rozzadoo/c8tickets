// Generates a printable Gate Staff Playbook PDF. Run: node scripts/make-gate-playbook.js
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'docs', 'Gate-Staff-Playbook.pdf');

const GOLD = '#c8922a';
const DARK = '#0c0a07';
const RED = '#b33a2a';
const GREEN = '#5d8a3c';
const AMBER = '#d69537';
const TEXT = '#1f1a10';
const MUTED = '#6a5c47';

const doc = new PDFDocument({
  size: 'LETTER',
  margins: { top: 42, bottom: 40, left: 46, right: 46 },
  info: {
    Title: 'C8 Tickets — Gate Staff Playbook',
    Author: 'C8 Tickets',
  },
});

doc.pipe(fs.createWriteStream(OUT));

// ── Header ────────────────────────────────────────────────
doc
  .fillColor(GOLD).fontSize(26).font('Helvetica-Bold')
  .text('C8 TICKETS', { align: 'left', characterSpacing: 3 });
doc
  .fillColor(MUTED).fontSize(11).font('Helvetica')
  .text('GATE STAFF PLAYBOOK', { align: 'left', characterSpacing: 2 });
doc.moveDown(0.4);
doc
  .strokeColor(GOLD).lineWidth(1.5)
  .moveTo(46, doc.y).lineTo(566, doc.y).stroke();
doc.moveDown(0.6);

// Intro
doc
  .fillColor(TEXT).fontSize(11).font('Helvetica')
  .text('Print this once per event. Keep one copy at the gate. Every staff member should read the "Quick Start" and "Signals" sections before doors open.', { lineGap: 2 });
doc.moveDown(0.8);

// ── Section helper ────────────────────────────────────────
function sectionTitle(text) {
  doc
    .fillColor(GOLD).fontSize(13).font('Helvetica-Bold')
    .text(text, { characterSpacing: 1.5 });
  doc.moveDown(0.25);
  doc.strokeColor('#d9c896').lineWidth(0.75)
    .moveTo(46, doc.y).lineTo(566, doc.y).stroke();
  doc.moveDown(0.35);
}
function bullet(text, opts = {}) {
  const indent = opts.indent || 0;
  doc
    .fillColor(TEXT).fontSize(11).font('Helvetica')
    .text(`•  ${text}`, {
      indent,
      lineGap: 2,
      paragraphGap: 2,
    });
}
function step(n, title, detail) {
  const yStart = doc.y;
  doc
    .fillColor(GOLD).fontSize(11).font('Helvetica-Bold')
    .text(`${n}.`, 46, yStart, { continued: true, lineGap: 2 })
    .fillColor(TEXT).font('Helvetica-Bold')
    .text(`  ${title}`);
  if (detail) {
    doc
      .fillColor(MUTED).fontSize(10).font('Helvetica')
      .text(detail, { indent: 14, lineGap: 2 });
  }
  doc.moveDown(0.15);
}

// ── Quick Start ───────────────────────────────────────────
sectionTitle('QUICK START (READ THIS FIRST)');
step(1, 'Log in with the gate account', 'Only need to do this once per phone. Do NOT log out at end of shift.');
step(2, 'Pick your event from the dropdown', 'Or leave on "All Today\'s Events" — the app blocks tickets from other days automatically.');
step(3, 'Tap "SCAN" then "Start Scanning"', 'Grant camera permission the first time.');
step(4, 'Hold the customer\'s QR code steady, 6–10 inches from the camera', 'Screen will react instantly when a code is detected.');
step(5, 'Read the fullscreen result — green = go, red = STOP', 'Tap anywhere to dismiss and scan the next person.');
doc.moveDown(0.5);

// ── Signal box ────────────────────────────────────────────
sectionTitle('SIGNAL COLORS');

function signalRow(color, title, meaning) {
  const y = doc.y;
  // Colored square
  doc.rect(46, y + 1, 14, 14).fillAndStroke(color, color);
  doc
    .fillColor(TEXT).fontSize(11).font('Helvetica-Bold')
    .text(title, 68, y, { continued: true })
    .fillColor(MUTED).font('Helvetica')
    .text(`  —  ${meaning}`);
  doc.moveDown(0.35);
}
signalRow(GREEN, 'GREEN — Checked In', 'Let them through. Move to next person.');
signalRow(AMBER, 'ORANGE — Already Checked In', 'Someone in the party already scanned this. Ask their name to verify. Do NOT let a duplicate in.');
signalRow(RED,   'RED — Wrong Event', 'Ticket belongs to a different event or day. Politely explain and redirect.');
signalRow(RED,   'RED — Entry Denied', 'Order was cancelled or refunded. Do NOT let them in. Refer to the promoter.');
signalRow(RED,   'RED — Ticket Not Found', 'QR isn\'t recognized. Ask the customer to open their confirmation email. If still no luck, use Manual tab.');
doc.moveDown(0.4);

// ── When to use Manual ────────────────────────────────────
sectionTitle('MANUAL SEARCH (WHEN QR WON\'T SCAN)');
bullet('Damaged QR, faded printout, or phone battery dead');
bullet('Customer forgot they need to show a QR');
bullet('Scanner is being finicky in low light');
doc.moveDown(0.25);
doc
  .fillColor(TEXT).fontSize(11).font('Helvetica-Bold')
  .text('How to use it:');
step(1, 'Tap "MANUAL" tab at the top');
step(2, 'Type first name or first few letters of email');
step(3, 'Tap the matching customer to expand their tickets');
step(4, 'Tap the individual "Check In" button, or "Check In All Remaining" for the whole group');
doc.moveDown(0.5);

// ── Rules of the Road ─────────────────────────────────────
sectionTitle('DO / DO NOT');
doc.fillColor(TEXT).fontSize(11).font('Helvetica-Bold').text('DO:');
bullet('Keep the app open on the Scan tab during your shift');
bullet('Trust the app — green means go, red means stop');
bullet('Use Manual search if a scan won\'t fire on the second try');
bullet('Check with a supervisor before overriding anything');
doc.moveDown(0.2);
doc.fillColor(TEXT).font('Helvetica-Bold').text('DO NOT:');
bullet('Log out at end of shift — the next staff member needs the session');
bullet('Force-quit the app during a rush — you\'ll lose 5–10 seconds relaunching');
bullet('Let anyone in on a RED screen without a manager\'s call');
bullet('Try to fix technical issues yourself during peak — flag a supervisor and use Manual');
doc.moveDown(0.5);

// ── Troubleshooting ───────────────────────────────────────
sectionTitle('TROUBLESHOOTING');
function tItem(problem, fix) {
  doc
    .fillColor(TEXT).fontSize(11).font('Helvetica-Bold')
    .text(problem, { lineGap: 1 })
    .fillColor(MUTED).font('Helvetica').fontSize(10.5)
    .text(fix, { indent: 8, lineGap: 2 });
  doc.moveDown(0.2);
}
tItem('Scanner shows the green box but never reads the QR',
      'Damaged or old ticket. Ask customer to zoom in on their phone screen. Or use Manual search.');
tItem('Camera won\'t open',
      'Check Settings, then C8 Tickets Staff, then make sure Camera is enabled. If just installed, first launch always asks; tap Allow.');
tItem('App says "Wrong Event" but you\'re sure it\'s the right one',
      'Check the event dropdown at the top. If wrong, switch it. If correct, the ticket may be for a different day.');
tItem('Everything is slow / scans take 5+ seconds',
      'Venue WiFi is likely weak. Ask a supervisor to switch to a hotspot. Manual search still works.');
tItem('App crashed or hung',
      'Swipe up from the bottom, close the app, reopen. Log in should be remembered.');

doc.moveDown(0.6);

// ── Footer ────────────────────────────────────────────────
doc.strokeColor(GOLD).lineWidth(0.5)
  .moveTo(46, doc.y).lineTo(566, doc.y).stroke();
doc.moveDown(0.35);
doc
  .fillColor(MUTED).fontSize(9).font('Helvetica-Oblique')
  .text('C8 Tickets Staff — Gate Playbook · Tech issues: contact supervisor · support@c8tickets.com', { align: 'center' });

doc.end();

doc.on('finish', () => console.log(`Wrote ${OUT}`));
console.log(`Writing ${OUT}...`);
