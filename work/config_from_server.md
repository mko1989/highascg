# Sample `casparcg.config` from production (custom resolution)

**Custom mode `3072x1728` @ 60 fps:** `<time-scale>60000</time-scale>` = `fps × 1000`; `<duration>1000</duration>` is always 1000; `<cadence>800</cadence>` = `48000 / fps`. At 50 fps: `time-scale` 50000, `cadence` 960, `duration` still 1000.

## Decklink inputs: one virtual screen, many layers

All Decklink **inputs** should share **a single channel** (one resolution / one “virtual screen”), not one channel per input. Each physical input is brought in as a **Decklink producer on its own layer** on that channel (e.g. layer 1 = SDI 1, layer 2 = SDI 2, …). The mixer then treats them like any other layers: they can be positioned, keyed, and **routed** elsewhere—other channels (e.g. program/preview), NDI consumers, multiview cells, or downstream processing—without duplicating full-screen channels per input.

- **Why one channel:** One `video-mode` and one raster; predictable memory and timing; routing and composition stay explicit (layers), not implicit (parallel full-frame channels).
- **Global `<decklink/>`:** In the sample below, the empty block enables Decklink support with defaults; per-input **device** and mode are chosen when loading the **producer** on each layer (AMCP / playout), not by multiplying `<channel>` entries for each SDI line.

---

```text
casparcg@serwer:/tmp$ cat /opt/casparcg/media/casparcg.config.ftd
<configuration>
    <paths>
        <media-path>media/</media-path>
        <log-path disable="false">log/</log-path>
        <data-path>media/</data-path>
        <template-path>template/</template-path>
    </paths>
    <lock-clear-phrase>secret</lock-clear-phrase>
    <channels>
        <channel>
            <video-mode>3072x1728</video-mode>
            <consumers>
                <screen>
                    <device>1</device>
                    <x>0</x><y>0</y>
                    <width>3072</width><height>1728</height>
                    <stretch>none</stretch>
                    <windowed>true</windowed>
                    <vsync>false</vsync>
                    <always-on-top>true</always-on-top>
                    <borderless>true</borderless>
                </screen>
            </consumers>
        </channel>
        <channel>
            <video-mode>3072x1728</video-mode>
            <consumers/>
        </channel>
        <channel>
            <video-mode>1080p6000</video-mode>
            <consumers>
                <screen>
                    <device>2</device>
                    <x>3840</x><y>0</y>
                    <width>1920</width><height>1080</height>
                    <stretch>none</stretch>
                    <windowed>true</windowed>
                    <vsync>true</vsync>
                    <borderless>false</borderless>
                </screen>
            </consumers>
        </channel>
    </channels>
    <video-modes>
        <video-mode>
            <id>3072x1728</id>
            <width>3072</width>
            <height>1728</height>
            <time-scale>60000</time-scale>
            <duration>1000</duration>
            <cadence>800</cadence>
        </video-mode>
    </video-modes>
    <controllers><tcp><port>5250</port><protocol>AMCP</protocol></tcp>
</controllers>   
 <osc>
  <default-port>6250</default-port>
  <disable-send-to-amcp-clients>false</disable-send-to-amcp-clients>
  <predefined-clients>
    <predefined-client>
      <address>127.0.0.1</address>
      <port>6251</port>
    </predefined-client>
  </predefined-clients>
</osc>
    <amcp><media-server><host>localhost</host><port>8000</port></media-server></amcp>
    <ndi><auto-load>false</auto-load></ndi>
    <decklink/>
    <html><enable-gpu>true</enable-gpu></html>
</configuration>
```

