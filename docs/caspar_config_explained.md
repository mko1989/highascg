
<?xml version="1.0" encoding="utf-8"?> <-- The opening XML declaration -->
<configuration>  <-- The opening element is configuration -->
    <paths> <-- Here we define all the paths to various resources the Server would need to access -->
 	<--
 	Note that all the paths presented in this default configuration file are relative to where you run CasparCG.exe
 	If CasparCG.exe is in c:\CasparCG\Server, then the media-path is c:\CasparCG\Server\media
 	-->
        <media-path>media/</media-path> <-- This is the path to media files (images and videos) -->
        <log-path>log/</log-path> <-- The Server creates logfiles in this location -->
        <data-path>data/</data-path> <-- CasparCG supports saving and retrieving data from the Server -->
        <template-path>template/</template-path> <-- The path to HTML and Flash templates and the resources they use -->
    </paths> <-- The end tag for the paths element -->
    <lock-clear-phrase>secret</lock-clear-phrase> <-- You can lock control of CasparCG and this would be the secret to unlock it -->
    <channels> <-- Here we configure all the channels that CasparCG will run -->
        <channel> <-- You can have multiple <channel>'s.  This would be channel number 1 -->
            <video-mode>720p5000</video-mode> <-- Here the resolution and frame rate is set to 1280x720 at 50 frames pr. second -->
            <consumers> <-- Consumers are the ouputs for the channel, you can only have one for each channel, but it can include multiple child-elements -->
                <screen /> <-- A screen consumer with default values -->
                <system-audio /> <-- System audio output with default values -->
            </consumers> <-- The end tag for the consumer element -->
        </channel> <-- The end tag for the channel element -->
        <-- Here you could define more channels, just like above, they're parsed sequentially, so a new channel here would be number 2 -->
    </channels> <-- The end tag for the channels element -->
    <controllers> <-- Controllers are ports and protocols used to control CasparCG -->
        <tcp> <-- This defines a new TCP controller -->
            <port>5250</port> <-- It will listen on all IP address of the server running CasparCG at port 5250 -->
            <protocol>AMCP</protocol> <-- The command protocol is AMCP -->
        </tcp> <-- The end tag for the tcp element -->
    </controllers> <-- The end tag for the controllers element -->
    <amcp> <-- This is new for version 2.2 and declares the handler for AMCP request related to media -->
        <media-server> <-- Define media-server -->
            <host>localhost</host> <-- Here we tell CasparCG that the media-server is running on the localhost, this could also be an IP address like 127.0.0.1 -->
            <port>8000</port> <-- The media-server is listening for request at port 8000 -->
        </media-server> <-- The end tag for the media-server element -->
    </amcp> <-- The end tag for the amcp elment -->
</configuration> <-- The end tag for the configuration element -->

<-- Then the example section of the casparcg.config file starts: -->
<-- For this demonstration I'm purposefully not commenting this section out, please note that you can not copy/paste this code and expect CasparCG to run correctly -->
<-- EVERYTHING BELOW ARE EXAMPLES AND WILL NOT FUNCTION CORRECTLY -->

<log-level> info  [trace|debug|info|warning|error|fatal]</log-level>
<-- log-level sets the verbosity of the Servers logs.
    The default option is trace, and if you wouldn't include a <log-level> element in your config, that would be used.
    Other possible options are then defined between the square brackets as trace, debug, info, warning, error and fatal.
    Using <log-level>trace<log-level> would log all activity of the Server, resulting in some very big log files. -->
<template-hosts>
<-- The Flash producer uses template-hosts to run and control your templates -->
    <template-host>
        <video-mode />
        <filename />
        <width />
        <height />
    </template-host>
</template-hosts>
<flash>
    <buffer-depth>auto [auto|1..]</buffer-depth>
    <-- The Flash producer has a configurable buffer-depth (a positive integer) or auto (which is recomended) -->
</flash>
<html>
<-- Since CasparCG uses the Chromium Embedded Framework for HTML templates it comes with DevTools built-in.
    If you define a port below you can run a HTML template and connect to it by simply opening up a Chrome browser and going to http://localhost:PORT/ to debug your template -->
    <remote-debugging-port>0 [0|1024-65535]</remote-debugging-port>
    <-- Set to zero, remote debugging is disabled -->
    <enable-gpu> false [true|false]</enable-gpu>
    <-- Here you can enable using GPU accelerated rendering in the HTML producers (it might cause issues, so is off by default) -->
</html>
<ndi>
<-- The latest builds of CasparCG support NDI inputs and outputs -->
    <auto-load>false [true|false]</auto-load>
    <-- This loads the NDI library when the Server is started -->
</ndi>
<channels>
    <channel>
    <-- Here we define a channel -->
        <video-mode>PAL [PAL|NTSC|576p2500|720p2398|720p2400|720p2500|720p5000|720p2997|720p5994|720p3000|720p6000|1080p2398|1080p2400|1080i5000|1080i5994|1080i6000|1080p2500|1080p2997
        |1080p3000|1080p5000|1080p5994|1080p6000|1556p2398|1556p2400|1556p2500|dci1080p2398|dci1080p2400|dci1080p2500|2160p2398|2160p2400|2160p2500|2160p2997|2160p3000|2160p5000|2160p5994
        |2160p6000|dci2160p2398|dci2160p2400|dci2160p2500]</video-mode>
        <-- The default mode is PAL and the other supported resolutions and framerates are found within the square brackets -->
        <consumers>
            <decklink>
                <device>[1..]</device><-- Here you define the number of the output you want to use on the Decklink card -->
                <key-device>device + 1 [1..]</key-device>
                <-- CasparCG supports sending the key output on separate output for cards that don't support key+fill outputs natively.  Key-device must be a number other than device. -->
                <embedded-audio>false [true|false]</embedded-audio> <-- If CasparCG should embedd audio on the SDI, it results in 1 extra frame of delay -->
                <latency>normal [normal|low|default]</latency> <-- The latency of the processing on the Decklink card, there normal/default is 1 frame slower than low, but is more stable -->
                <keyer>external [external|external_separate_device|internal|default]</keyer>
                <-- Configure the keyer of the card.  If your card support internal key-fill processing (like the Extreme models) you would use external.  If you are using another
                channel for the key you would use external_separate_device.  Internal keyer will use the input signal on the card and add the keyed signal from CasparCG (passthrough). ->
                <key-only>false [true|false]</key-only>
                <-- Output only the key signal, you would use this when you define a Decklink consumer as the key for another Decklink consumer -->
                <buffer-depth>3 [1..]</buffer-depth>
                <-- This sets the buffer of the frames sent to the Decklink card.  Newer 4K models can use a buffer-depth of 2, older models usually need a buffer-depth of 3, increasing the buffer-depth
                results in higher latency.  There is an upper limit to the buffer-depth, but that depends on the card, system memory and other factors. -->
            </decklink>
      	    <bluefish>
                <device>[1..]</device> <-- The number of Bluefish card  to use-->
                <sdi-stream>1[1..] </sdi-stream> <-- The number of the output to use on the card -->
                <embedded-audio>false [true|false]</embedded-audio> <-- Embedd audio on the SDI output -->
                <keyer>disabled [external|internal|disabled] (external only supported on channels 1 and 3, using 3 requires 4 out connectors) ( internal only available on devices with a hardware keyer) </keyer>
                <internal-keyer-audio-source> videooutputchannel [videooutputchannel|sdivideoinput] ( only valid when using internal keyer option)</internal-keyer-audio-source>
                <-- Much like the Decklink above -->
                <watchdog>2[0..] ( set to 0 to disable the HW watchdog functionality, otherwise this value indicates how many frames to wait after a crash, before enabling the bypass relay's on the card - only works on sdi-stream 1) </watchdog>
            </bluefish>
            <system-audio>
                <channel-layout>stereo [mono|stereo|matrix]</channel-layout> <-- The channel-layout for the audio from the default Windows or Linux soundcard -->
                <latency>200 [0..]</latency> <-- Configurable latency, some use this to try and sync system-audio with the video from another output -->
            </system-audio>
            <screen>
                <device>1 [1..]</device> <-- Which screen to use if windowed is disabled below -->
                <aspect-ratio>default [default|4:3|16:9]</aspect-ratio>  <-- Set the aspect-ratio-->
                <stretch>fill [none|fill|uniform|uniform_to_fill]</stretch> <-- How to fill the window -->
                <windowed>true [true|false]</windowed> <-- If true the output will be in a controllable window, otherwise fullscreen -->
                <key-only>false [true|false]</key-only> <-- Output only the key -->
                <vsync>false [true|false]</vsync> <-- V-sync -->
                <borderless>false [true|false]</borderless> <-- Disable border/window-chrome -->
                <interactive>true [true|false]</interactive>  <-- If the screen consumer should send mouse interaction to CEF.  You could open up a website and interact withit like it would be running in your browser -->
                <always-on-top>false [true|false]<</always-on-top> <-- Fix window so it's always on top of other windows -->
                <x>0</x> <-- Location -->
                <y>0</y> <-- Location -->
                <width>0 (0=not set)</width> <-- Width -->
                <height>0 (0=not set)</height> <-- Height -->
                <sbs-key>false [true|false]</sbs-key> <-- This enables a side-by-side key which can be used with a DataVideo vision switcher -->
                <colour-space>RGB [RGB|datavideo-full|datavideo-limited] (Enables colour space convertion for DataVideo TC-100 / TC-200)</colour-space>
            </screen>
            <newtek-ivga></newtek-ivga> <-- Enable the original iVGA/NDI -->
            <ndi>
                <name>[custom name]</name> <-- Defines the name of the NDI output -->
                <allow-fields>false [true|false]</allow-fields> <-- If NDI output should be interlaced or progessive -->
            </ndi>
            <ffmpeg>
                <path>[file|url]</path> <--  -->
                <args>[most ffmpeg arguments related to filtering and output codecs]</args> <--  -->
            </ffmpeg>
        </consumers>
    </channel>
</channels>
<osc>
  <default-port>6250</default-port> <--  -->
  <disable-send-to-amcp-clients>false [true|false]</disable-send-to-amcp-clients> <--  -->
  <predefined-clients> <--  -->
    <predefined-client> <--  -->
      <address>127.0.0.1</address> <--  -->
      <port>5253</port> <--  -->
    </predefined-client>
  </predefined-clients>
</osc>
-->

---

## Custom `<video-mode>` (when `id` is width×height, not a preset)

Caspar expects a matching block under `<video-modes>` with:

| Element | Meaning |
|--------|---------|
| `<time-scale>` | **`fps × 1000`** (e.g. 50 → 50000, 60 → 60000). |
| `<duration>` | **Always `1000`** in generated configs. |
| `<cadence>` | **`48000 / fps`** rounded — 48 kHz sample rate divided by frame rate (e.g. **50 fps → 960**, **60 fps → 800**, **25 fps → 1920**). |

HighAsCG emits `time-scale = round(fps × 1000)`, `duration = 1000`, and `cadence = calculateCadence(fps)` (`src/config/config-generator.js` / `config-modes.js`).

See `work/config_from_server.md` for a live example (`3072x1728` @ 60 Hz: `cadence` 800, `time-scale` 60000).