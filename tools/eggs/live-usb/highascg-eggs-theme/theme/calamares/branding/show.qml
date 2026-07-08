/* HighAsCG Calamares installer slideshow (WO-148).
 *
 * Minimal branded slide set: solid dark background + HighAsCG wordmark,
 * colours taken from the GRUB theme palette
 * (tools/eggs/live-usb/highascg-eggs-theme/theme/livecd/grub.theme.cfg):
 *   background #0c1220, panel #121a2a (18,26,42), accent #5eb3ff (94,179,255),
 *   body text #b8c4d8, titles white.
 *
 * Owner can replace highascg-mascot.png (and add richer slide artwork) later;
 * keep the file name stable or update the Image sources below.
 */

import QtQuick 2.0;
import calamares.slideshow 1.0;

Presentation
{
    id: presentation

    function nextSlide() { presentation.goToNextSlide(); }

    Timer {
        id: advanceTimer
        interval: 7500
        running: true
        repeat: true
        onTriggered: nextSlide()
    }

    // --- HighAsCG palette (mirrors grub.theme.cfg) ---
    property string bgColor: "#0c1220"
    property string panelColor: "#121a2a"
    property string accentColor: "#5eb3ff"
    property string bodyColor: "#b8c4d8"
    property string titleColor: "#ffffff"
    property string textFont: "Helvetica"

    // Solid dark background behind every slide
    Rectangle {
        anchors.fill: parent
        color: bgColor
        z: -1
    }

    // --- SLIDE 1: wordmark ---
    Slide {
        Column {
            anchors.centerIn: parent
            spacing: 24
            width: parent.width * 0.8

            Image {
                source: "highascg-mascot.png"
                fillMode: Image.PreserveAspectFit
                height: 220
                anchors.horizontalCenter: parent.horizontalCenter
            }
            Text {
                font.family: textFont; font.pixelSize: 64; font.bold: true
                color: titleColor
                anchors.horizontalCenter: parent.horizontalCenter
                text: "HighAsCG"
            }
            Rectangle {
                width: 220; height: 4; radius: 2
                color: accentColor
                anchors.horizontalCenter: parent.horizontalCenter
            }
            Text {
                font.family: textFont; font.pixelSize: 24
                color: bodyColor
                anchors.horizontalCenter: parent.horizontalCenter
                horizontalAlignment: Text.AlignHCenter
                width: parent.width
                wrapMode: Text.WordWrap
                text: qsTr("Broadcast graphics playout — installing to this machine")
            }
        }
    }

    // --- SLIDE 2: what you get ---
    Slide {
        Column {
            anchors.centerIn: parent
            spacing: 20
            width: parent.width * 0.8

            Text {
                font.family: textFont; font.pixelSize: 40; font.bold: true
                color: accentColor
                anchors.horizontalCenter: parent.horizontalCenter
                text: qsTr("One-box playout")
            }
            Text {
                font.family: textFont; font.pixelSize: 22
                color: bodyColor
                width: parent.width
                wrapMode: Text.WordWrap
                horizontalAlignment: Text.AlignHCenter
                text: qsTr("CasparCG server, the HighAsCG operator UI and the output pipeline are preinstalled and start automatically on boot — no desktop setup needed.")
            }
        }
    }

    // --- SLIDE 3: operator data ---
    Slide {
        Column {
            anchors.centerIn: parent
            spacing: 20
            width: parent.width * 0.8

            Text {
                font.family: textFont; font.pixelSize: 40; font.bold: true
                color: accentColor
                anchors.horizontalCenter: parent.horizontalCenter
                text: qsTr("Operator data stays on the stick")
            }
            Text {
                font.family: textFont; font.pixelSize: 22
                color: bodyColor
                width: parent.width
                wrapMode: Text.WordWrap
                horizontalAlignment: Text.AlignHCenter
                text: qsTr("Configs, media and drop-updates live on the HIGHASCGEXF exFAT partition of the operator USB stick, so they survive reinstalls and travel between machines.")
            }
        }
    }

    // --- SLIDE 4: please wait ---
    Slide {
        Column {
            anchors.centerIn: parent
            spacing: 24
            width: parent.width * 0.8

            Image {
                source: "highascg-mascot.png"
                fillMode: Image.PreserveAspectFit
                height: 180
                anchors.horizontalCenter: parent.horizontalCenter
            }
            Text {
                font.family: textFont; font.pixelSize: 40; font.bold: true
                color: titleColor
                anchors.horizontalCenter: parent.horizontalCenter
                text: qsTr("Please wait")
            }
            Text {
                font.family: textFont; font.pixelSize: 22
                color: bodyColor
                width: parent.width
                wrapMode: Text.WordWrap
                horizontalAlignment: Text.AlignHCenter
                text: qsTr("Installation is in progress. Do not power off the machine or remove the USB stick until it completes.")
            }
        }
    }

    function onActivate() { presentation.currentSlide = 0; }
}
