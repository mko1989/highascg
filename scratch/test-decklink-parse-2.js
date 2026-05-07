const { parseInfoConfigForDecklinks } = require('../src/utils/decklink-enum')

const xml = `
<configuration>
   <paths>
      <media-path>media/</media-path>
      <log-path>log/</log-path>
      <data-path>data/</data-path>
      <template-path>template/</template-path>
      <thumbnail-path>thumbnail/</thumbnail-path>
      <font-path>font/</font-path>
   </paths>
   <channels>
      <channel>
         <video-mode>5760x1080</video-mode>
         <channel-layout>stereo</channel-layout>
         <consumers>
            <system-audio/>
            <decklink>
               <device>4</device>
               <embedded-audio>true</embedded-audio>
               <latency>normal</latency>
               <keyer>external</keyer>
               <key-only>false</key-only>
            </decklink>
         </consumers>
         <mixer>
            <audio-osc>true</audio-osc>
         </mixer>
      </channel>
   </channels>
</configuration>
`

parseInfoConfigForDecklinks(xml, (result) => {
    console.log(JSON.stringify(result, null, 2))
})
