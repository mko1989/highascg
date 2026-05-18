[2026-04-05 09:07:18.294] [info]    async_event_server[:5250] Client 127.0.0.1 disconnected (0 connections).
[2026-04-05 09:07:18.510] [info]    async_event_server[:5250] Accepted connection from 127.0.0.1 (1 connections).
[2026-04-05 09:07:18.521] [info]    Received message from 127.0.0.1: VERSION\r\n
[2026-04-05 09:07:18.521] [info]    Sent message to 127.0.0.1:201 VERSION OK\r\n2.5.0 N/A Stable\r\n
[2026-04-05 09:07:21.022] [info]    Received message from 127.0.0.1: REMOVE 1 STREAM udp://127.0.0.1:10001\r\n
[2026-04-05 09:07:21.023] [info]    ffmpeg[udp://127.0.0.1:10001] Uninitialized.
[2026-04-05 09:07:21.023] [info]    Sent message to 127.0.0.1:202 REMOVE OK\r\n
[2026-04-05 09:07:21.026] [info]    [ffmpeg] [aac @ 0x712a965fef00] Qavg: 65536.000
[2026-04-05 09:07:21.026] [info]    
[2026-04-05 09:07:21.028] [info]    [ffmpeg] [libx264 @ 0x712a951c9200] frame I:311   Avg QP:25.36  size: 59541
[2026-04-05 09:07:21.028] [info]    
[2026-04-05 09:07:21.028] [info]    [ffmpeg] [libx264 @ 0x712a951c9200] frame P:15213 Avg QP:28.19  size:  9155
[2026-04-05 09:07:21.028] [info]    
[2026-04-05 09:07:21.028] [info]    [ffmpeg] [libx264 @ 0x712a951c9200] mb I  I16..4: 100.0%  0.0%  0.0%
[2026-04-05 09:07:21.028] [info]    
[2026-04-05 09:07:21.028] [info]    [ffmpeg] [libx264 @ 0x712a951c9200] mb P  I16..4:  0.2%  0.0%  0.0%  P16..4: 18.9%  0.0%  0.0%  0.0%  0.0%    skip:80.8%
[2026-04-05 09:07:21.028] [info]    
[2026-04-05 09:07:21.028] [info]    [ffmpeg] [libx264 @ 0x712a951c9200] final ratefactor: 30.44
[2026-04-05 09:07:21.028] [info]    
[2026-04-05 09:07:21.028] [info]    [ffmpeg] [libx264 @ 0x712a951c9200] coded y,uvDC,uvAC intra: 55.6% 57.7% 46.1% inter: 12.1% 8.2% 5.6%
[2026-04-05 09:07:21.028] [info]    
[2026-04-05 09:07:21.028] [info]    [ffmpeg] [libx264 @ 0x712a951c9200] i16 v,h,dc,p: 49% 25% 23%  2%
[2026-04-05 09:07:21.028] [info]    
[2026-04-05 09:07:21.028] [info]    [ffmpeg] [libx264 @ 0x712a951c9200] i8c dc,h,v,p: 47% 28% 24%  2%
[2026-04-05 09:07:21.028] [info]    
[2026-04-05 09:07:21.028] [info]    [ffmpeg] [libx264 @ 0x712a951c9200] kb/s:2032.88
[2026-04-05 09:07:21.028] [info]    
[2026-04-05 09:07:21.032] [info]    ffmpeg[udp://127.0.0.1:10001] Uninitialized.
[2026-04-05 09:07:21.174] [info]    Received message from 127.0.0.1: ADD 1 STREAM udp://127.0.0.1:10001 -filter:v scale=960:540,format=yuv420p,fps=25 -codec:v libx264 -preset:v ultrafast -tune:v zerolatency -b:v 2000k -g:v 50 -x264-params:v min-keyint=25:scenecut=0:repeat-headers=1 -filter:a aformat=channel_layouts=stereo,aresample=48000 -codec:a aac -b:a 128k -format mpegts\r\n
[2026-04-05 09:07:21.175] [info]    ffmpeg[udp://127.0.0.1:10001] Initialized.
[2026-04-05 09:07:21.175] [info]    Sent message to 127.0.0.1:202 ADD OK\r\n
[2026-04-05 09:07:21.208] [info]    [ffmpeg] [libx264 @ 0x7129f51c9500] using SAR=1/1
[2026-04-05 09:07:21.208] [info]    
[2026-04-05 09:07:21.210] [info]    [ffmpeg] [libx264 @ 0x7129f51c9500] using cpu capabilities: MMX2 SSE2Fast SSSE3 SSE4.2 AVX FMA3 BMI2 AVX2
[2026-04-05 09:07:21.210] [info]    
[2026-04-05 09:07:21.212] [info]    [ffmpeg] [libx264 @ 0x7129f51c9500] profile Constrained Baseline, level 3.1, 4:2:0, 8-bit
[2026-04-05 09:07:21.212] [info]    
[2026-04-05 09:07:21.276] [info]    Received message from 127.0.0.1: REMOVE 2 STREAM udp://127.0.0.1:10002\r\n
[2026-04-05 09:07:21.277] [info]    ffmpeg[udp://127.0.0.1:10002] Uninitialized.
[2026-04-05 09:07:21.277] [info]    Sent message to 127.0.0.1:202 REMOVE OK\r\n
[2026-04-05 09:07:21.291] [info]    [ffmpeg] [aac @ 0x712a9e5ff080] Qavg: 65536.000
[2026-04-05 09:07:21.291] [info]    
[2026-04-05 09:07:21.292] [info]    [ffmpeg] [libx264 @ 0x712a9d1c9bc0] frame I:311   Avg QP:26.64  size: 59918
[2026-04-05 09:07:21.292] [info]    
[2026-04-05 09:07:21.292] [info]    [ffmpeg] [libx264 @ 0x712a9d1c9bc0] frame P:15213 Avg QP:29.64  size:  9078
[2026-04-05 09:07:21.292] [info]    
[2026-04-05 09:07:21.292] [info]    [ffmpeg] [libx264 @ 0x712a9d1c9bc0] mb I  I16..4: 100.0%  0.0%  0.0%
[2026-04-05 09:07:21.292] [info]    
[2026-04-05 09:07:21.292] [info]    [ffmpeg] [libx264 @ 0x712a9d1c9bc0] mb P  I16..4:  0.3%  0.0%  0.0%  P16..4: 20.1%  0.0%  0.0%  0.0%  0.0%    skip:79.7%
[2026-04-05 09:07:21.292] [info]    
[2026-04-05 09:07:21.292] [info]    [ffmpeg] [libx264 @ 0x712a9d1c9bc0] final ratefactor: 31.02
[2026-04-05 09:07:21.292] [info]    
[2026-04-05 09:07:21.292] [info]    [ffmpeg] [libx264 @ 0x712a9d1c9bc0] coded y,uvDC,uvAC intra: 57.5% 59.9% 47.9% inter: 13.0% 8.7% 5.9%
[2026-04-05 09:07:21.292] [info]    
[2026-04-05 09:07:21.292] [info]    [ffmpeg] [libx264 @ 0x712a9d1c9bc0] i16 v,h,dc,p: 48% 26% 23%  2%
[2026-04-05 09:07:21.292] [info]    
[2026-04-05 09:07:21.292] [info]    [ffmpeg] [libx264 @ 0x712a9d1c9bc0] i8c dc,h,v,p: 49% 24% 24%  2%
[2026-04-05 09:07:21.292] [info]    
[2026-04-05 09:07:21.292] [info]    [ffmpeg] [libx264 @ 0x712a9d1c9bc0] kb/s:2019.27
[2026-04-05 09:07:21.292] [info]    
[2026-04-05 09:07:21.294] [info]    ffmpeg[udp://127.0.0.1:10002] Uninitialized.
[2026-04-05 09:07:21.429] [info]    Received message from 127.0.0.1: ADD 2 STREAM udp://127.0.0.1:10002 -filter:v scale=960:540,format=yuv420p,fps=25 -codec:v libx264 -preset:v ultrafast -tune:v zerolatency -b:v 2000k -g:v 50 -x264-params:v min-keyint=25:scenecut=0:repeat-headers=1 -filter:a aformat=channel_layouts=stereo,aresample=48000 -codec:a aac -b:a 128k -format mpegts\r\n
[2026-04-05 09:07:21.429] [info]    ffmpeg[udp://127.0.0.1:10002] Initialized.
[2026-04-05 09:07:21.429] [info]    Sent message to 127.0.0.1:202 ADD OK\r\n
[2026-04-05 09:07:21.446] [info]    [ffmpeg] [libx264 @ 0x712ba159c840] using SAR=1/1
[2026-04-05 09:07:21.446] [info]    
[2026-04-05 09:07:21.450] [info]    [ffmpeg] [libx264 @ 0x712ba159c840] using cpu capabilities: MMX2 SSE2Fast SSSE3 SSE4.2 AVX FMA3 BMI2 AVX2
[2026-04-05 09:07:21.450] [info]    
[2026-04-05 09:07:21.451] [info]    [ffmpeg] [libx264 @ 0x712ba159c840] profile Constrained Baseline, level 3.1, 4:2:0, 8-bit
[2026-04-05 09:07:21.451] [info]    
[2026-04-05 09:07:21.531] [info]    Received message from 127.0.0.1: REMOVE 3 STREAM udp://127.0.0.1:10005\r\n
[2026-04-05 09:07:21.531] [info]    ffmpeg[udp://127.0.0.1:10005] Uninitialized.
[2026-04-05 09:07:21.531] [info]    Sent message to 127.0.0.1:202 REMOVE OK\r\n
[2026-04-05 09:07:21.541] [info]    [ffmpeg] [aac @ 0x712af1dfed40] Qavg: 65536.000
[2026-04-05 09:07:21.541] [info]    
[2026-04-05 09:07:21.542] [info]    [ffmpeg] [libx264 @ 0x712af094f300] frame I:311   Avg QP:15.14  size: 63495
[2026-04-05 09:07:21.542] [info]    
[2026-04-05 09:07:21.542] [info]    [ffmpeg] [libx264 @ 0x712af094f300] frame P:15213 Avg QP:17.75  size:  9463
[2026-04-05 09:07:21.542] [info]    
[2026-04-05 09:07:21.542] [info]    [ffmpeg] [libx264 @ 0x712af094f300] mb I  I16..4: 100.0%  0.0%  0.0%
[2026-04-05 09:07:21.542] [info]    
[2026-04-05 09:07:21.542] [info]    [ffmpeg] [libx264 @ 0x712af094f300] mb P  I16..4:  0.0%  0.0%  0.0%  P16..4:  8.6%  0.0%  0.0%  0.0%  0.0%    skip:91.4%
[2026-04-05 09:07:21.542] [info]    
[2026-04-05 09:07:21.542] [info]    [ffmpeg] [libx264 @ 0x712af094f300] final ratefactor: 24.43
[2026-04-05 09:07:21.542] [info]    
[2026-04-05 09:07:21.542] [info]    [ffmpeg] [libx264 @ 0x712af094f300] coded y,uvDC,uvAC intra: 26.6% 27.1% 26.4% inter: 6.6% 5.1% 4.3%
[2026-04-05 09:07:21.542] [info]    
[2026-04-05 09:07:21.542] [info]    [ffmpeg] [libx264 @ 0x712af094f300] i16 v,h,dc,p: 61% 16% 21%  1%
[2026-04-05 09:07:21.542] [info]    
[2026-04-05 09:07:21.542] [info]    [ffmpeg] [libx264 @ 0x712af094f300] i8c dc,h,v,p: 71% 17% 11%  1%
[2026-04-05 09:07:21.542] [info]    
[2026-04-05 09:07:21.542] [info]    [ffmpeg] [libx264 @ 0x712af094f300] kb/s:2109.03
[2026-04-05 09:07:21.542] [info]    
[2026-04-05 09:07:21.543] [info]    ffmpeg[udp://127.0.0.1:10005] Uninitialized.
[2026-04-05 09:07:21.684] [info]    Received message from 127.0.0.1: ADD 3 STREAM udp://127.0.0.1:10005 -filter:v scale=960:540,format=yuv420p,fps=25 -codec:v libx264 -preset:v ultrafast -tune:v zerolatency -b:v 2000k -g:v 50 -x264-params:v min-keyint=25:scenecut=0:repeat-headers=1 -filter:a aformat=channel_layouts=stereo,aresample=48000 -codec:a aac -b:a 128k -format mpegts\r\n
[2026-04-05 09:07:21.685] [info]    ffmpeg[udp://127.0.0.1:10005] Initialized.
[2026-04-05 09:07:21.685] [info]    Sent message to 127.0.0.1:202 ADD OK\r\n
[2026-04-05 09:07:21.698] [info]    [ffmpeg] [libx264 @ 0x712ae9d16dc0] using SAR=1/1
[2026-04-05 09:07:21.698] [info]    
[2026-04-05 09:07:21.702] [info]    [ffmpeg] [libx264 @ 0x712ae9d16dc0] using cpu capabilities: MMX2 SSE2Fast SSSE3 SSE4.2 AVX FMA3 BMI2 AVX2
[2026-04-05 09:07:21.702] [info]    
[2026-04-05 09:07:21.703] [info]    [ffmpeg] [libx264 @ 0x712ae9d16dc0] profile Constrained Baseline, level 3.1, 4:2:0, 8-bit
[2026-04-05 09:07:21.703] [info]    
[2026-04-05 09:07:24.288] [info]    Received message from 127.0.0.1: INFO 1\r\n
[2026-04-05 09:07:24.288] [info]    Sent more than 512 bytes to 127.0.0.1
[2026-04-05 09:07:24.289] [info]    Received message from 127.0.0.1: INFO 2\r\n
[2026-04-05 09:07:24.296] [info]    Sent more than 512 bytes to 127.0.0.1
[2026-04-05 09:07:24.298] [info]    Received message from 127.0.0.1: INFO 3\r\n
[2026-04-05 09:07:24.299] [info]    Sent more than 512 bytes to 127.0.0.1
[2026-04-05 09:07:32.617] [info]    Received message from 127.0.0.1: THUMBNAIL RETRIEVE LED-GRID-3584X1408\r\n
[2026-04-05 09:07:32.622] [info]    Sent more than 512 bytes to 127.0.0.1
[2026-04-05 09:07:32.623] [info]    Received message from 127.0.0.1: THUMBNAIL RETRIEVE LED-GRID-12288X1280\r\n
[2026-04-05 09:07:32.632] [info]    Sent more than 512 bytes to 127.0.0.1
[2026-04-05 09:07:43.317] [info]    Received message from 127.0.0.1: CLS\r\n
[2026-04-05 09:07:43.322] [info]    Sent more than 512 bytes to 127.0.0.1
[2026-04-05 09:07:43.324] [info]    Received message from 127.0.0.1: TLS\r\n
[2026-04-05 09:07:43.326] [info]    Sent message to 127.0.0.1:200 TLS OK\r\nMULTIVIEW_OVERLAY\r\n\r\n
[2026-04-05 09:07:47.272] [info]    Received message from 127.0.0.1: THUMBNAIL RETRIEVE PIEKLOKOBIET_S01E01_MASTER_178_R709_PL-XX_20DFX_HD_25FPS_HAP_20260210\r\n
[2026-04-05 09:07:47.274] [info]    Sent more than 512 bytes to 127.0.0.1
[2026-04-05 09:07:47.641] [info]    Received message from 127.0.0.1: PLAY 2-10 PIEKLOKOBIET_S01E01_MASTER_178_R709_PL-XX_20DFX_HD_25FPS_HAP_20260210\r\n
[2026-04-05 09:07:47.644] [info]    Sent message to 127.0.0.1:202 PLAY OK\r\n
[2026-04-05 09:07:47.650] [info]    Received message from 127.0.0.1: MIXER 2-10 ANCHOR 0 0\r\n
[2026-04-05 09:07:47.650] [info]    Sent message to 127.0.0.1:202 MIXER OK\r\n
[2026-04-05 09:07:47.651] [info]    Received message from 127.0.0.1: MIXER 2-10 FILL 0 0 1 1 0\r\n
[2026-04-05 09:07:47.651] [info]    Sent message to 127.0.0.1:202 MIXER OK\r\n
[2026-04-05 09:07:47.652] [info]    Received message from 127.0.0.1: MIXER 2-10 ROTATION 0 0\r\n
[2026-04-05 09:07:47.653] [info]    Sent message to 127.0.0.1:202 MIXER OK\r\n
[2026-04-05 09:07:47.653] [info]    Received message from 127.0.0.1: MIXER 2-10 OPACITY 1 0\r\n
[2026-04-05 09:07:47.654] [info]    Sent message to 127.0.0.1:202 MIXER OK\r\n
[2026-04-05 09:07:47.654] [info]    Received message from 127.0.0.1: MIXER 2-10 KEYER 0\r\n
[2026-04-05 09:07:47.655] [info]    Sent message to 127.0.0.1:202 MIXER OK\r\n
[2026-04-05 09:07:47.655] [info]    Received message from 127.0.0.1: MIXER 2 COMMIT\r\n
[2026-04-05 09:07:47.655] [info]    Sent message to 127.0.0.1:202 MIXER OK\r\n
[2026-04-05 09:07:47.678] [warning] [ffmpeg] [Parsed_amerge_0 @ 0x712a0820c8c0] No channel layout for input 1
[2026-04-05 09:07:47.678] [warning] 
[2026-04-05 09:07:47.679] [warning] [ffmpeg] [Parsed_amerge_0 @ 0x712a0820c8c0] Input channel layouts overlap: output layout will be determined by the number of distinct input channels
[2026-04-05 09:07:47.679] [warning] 
[2026-04-05 09:07:47.739] [info]    image_producer[media/led-grid-3584x1408.png] Destroyed.
[2026-04-05 09:07:47.739] [warning] ffmpeg[PIEKLOKOBIET_S01E01_MASTER_178_R709_PL-XX_20DFX_HD_25FPS_HAP_20260210|0.0000/2850.4000] Latency: 6
[2026-04-05 09:07:53.442] [info]    Received message from 127.0.0.1: PLAY 2-10 PIEKLOKOBIET_S01E01_MASTER_178_R709_PL-XX_20DFX_HD_25FPS_HAP_20260210\r\n
[2026-04-05 09:07:53.444] [info]    Sent message to 127.0.0.1:202 PLAY OK\r\n
[2026-04-05 09:07:53.444] [info]    Received message from 127.0.0.1: MIXER 2-10 ANCHOR 0 0\r\n
[2026-04-05 09:07:53.444] [info]    Sent message to 127.0.0.1:202 MIXER OK\r\n
[2026-04-05 09:07:53.444] [info]    Received message from 127.0.0.1: MIXER 2-10 FILL 0 0 1 1 0\r\n
[2026-04-05 09:07:53.445] [info]    Sent message to 127.0.0.1:202 MIXER OK\r\n
[2026-04-05 09:07:53.447] [info]    Received message from 127.0.0.1: MIXER 2-10 ROTATION 0 0\r\n
[2026-04-05 09:07:53.448] [info]    Received message from 127.0.0.1: MIXER 2-10 OPACITY 1 0\r\n
[2026-04-05 09:07:53.447] [info]    Sent message to 127.0.0.1:202 MIXER OK\r\n
[2026-04-05 09:07:53.448] [info]    Sent message to 127.0.0.1:202 MIXER OK\r\n
[2026-04-05 09:07:53.448] [info]    Received message from 127.0.0.1: MIXER 2-10 KEYER 0\r\n
[2026-04-05 09:07:53.449] [info]    Sent message to 127.0.0.1:202 MIXER OK\r\n
[2026-04-05 09:07:53.449] [info]    Received message from 127.0.0.1: MIXER 2 COMMIT\r\n
[2026-04-05 09:07:53.450] [info]    Sent message to 127.0.0.1:202 MIXER OK\r\n
[2026-04-05 09:07:53.462] [warning] [ffmpeg] [Parsed_amerge_0 @ 0x7128ac20bac0] No channel layout for input 1
[2026-04-05 09:07:53.462] [warning] 
[2026-04-05 09:07:53.462] [warning] [ffmpeg] [Parsed_amerge_0 @ 0x7128ac20bac0] Input channel layouts overlap: output layout will be determined by the number of distinct input channels
[2026-04-05 09:07:53.462] [warning] 
[2026-04-05 09:07:53.475] [info]    Received message from 127.0.0.1: BEGIN\r\n
[2026-04-05 09:07:53.475] [info]    Received message from 127.0.0.1: STOP 1-110\r\n
[2026-04-05 09:07:53.475] [info]    Received message from 127.0.0.1: MIXER 1-110 CLEAR\r\n
[2026-04-05 09:07:53.475] [info]    Received message from 127.0.0.1: PLAY 1-110 PIEKLOKOBIET_S01E01_MASTER_178_R709_PL-XX_20DFX_HD_25FPS_HAP_20260210\r\n
[2026-04-05 09:07:53.475] [info]    Received message from 127.0.0.1: MIXER 1-110 ANCHOR 0 0\r\n
[2026-04-05 09:07:53.475] [info]    Received message from 127.0.0.1: MIXER 1-110 FILL 0 0 1 1 0\r\n
[2026-04-05 09:07:53.475] [info]    Received message from 127.0.0.1: MIXER 1-110 ROTATION 0 0\r\n
[2026-04-05 09:07:53.475] [info]    Received message from 127.0.0.1: MIXER 1-110 OPACITY 1 0\r\n
[2026-04-05 09:07:53.475] [info]    Received message from 127.0.0.1: MIXER 1-110 KEYER 0\r\n
[2026-04-05 09:07:53.475] [info]    Received message from 127.0.0.1: COMMIT\r\n
[2026-04-05 09:07:53.475] [warning] Executing batch: BATCH(8 commands)
[2026-04-05 09:07:53.475] [info]    Sent message to 127.0.0.1:202 MIXER OK\r\n
[2026-04-05 09:07:53.475] [info]    Sent message to 127.0.0.1:202 STOP OK\r\n
[2026-04-05 09:07:53.478] [info]    Sent message to 127.0.0.1:202 PLAY OK\r\n
[2026-04-05 09:07:53.478] [info]    Sent message to 127.0.0.1:202 MIXER OK\r\n
[2026-04-05 09:07:53.478] [info]    Sent message to 127.0.0.1:202 MIXER OK\r\n
[2026-04-05 09:07:53.478] [info]    Sent message to 127.0.0.1:202 MIXER OK\r\n
[2026-04-05 09:07:53.479] [info]    image_producer[media/led-grid-3584x1408.png] Destroyed.
[2026-04-05 09:07:53.479] [info]    Sent message to 127.0.0.1:202 MIXER OK\r\n
[2026-04-05 09:07:53.479] [info]    Sent message to 127.0.0.1:202 MIXER OK\r\n
[2026-04-05 09:07:53.480] [info]    Sent message to 127.0.0.1:202 COMMIT OK\r\n
[2026-04-05 09:07:53.515] [warning] [ffmpeg] [Parsed_amerge_0 @ 0x71287020b700] No channel layout for input 1
[2026-04-05 09:07:53.515] [warning] 
[2026-04-05 09:07:53.515] [warning] [ffmpeg] [Parsed_amerge_0 @ 0x71287020b700] Input channel layouts overlap: output layout will be determined by the number of distinct input channels
[2026-04-05 09:07:53.515] [warning] 
[2026-04-05 09:07:53.519] [info]    Received message from 127.0.0.1: MIXER 1 COMMIT\r\n
[2026-04-05 09:07:53.519] [info]    Sent message to 127.0.0.1:202 MIXER OK\r\n
[2026-04-05 09:07:53.539] [warning] ffmpeg[PIEKLOKOBIET_S01E01_MASTER_178_R709_PL-XX_20DFX_HD_25FPS_HAP_20260210|0.0000/2850.4000] Latency: 6
[2026-04-05 09:07:53.539] [info]    ffmpeg[media/PiekloKobiet_S01E01_Master_178_R709_PL-XX_20DFX_HD_25fps_HAP_20260210.mov|346/171024] Destroyed.
[2026-04-05 09:07:53.573] [warning] ffmpeg[PIEKLOKOBIET_S01E01_MASTER_178_R709_PL-XX_20DFX_HD_25FPS_HAP_20260210|0.0000/2850.4000] Latency: 10
[2026-04-05 09:07:53.894] [info]    Received message from 127.0.0.1: PLAY 2-10 PIEKLOKOBIET_S01E01_MASTER_178_R709_PL-XX_20DFX_HD_25FPS_HAP_20260210\r\n
[2026-04-05 09:07:53.901] [info]    Sent message to 127.0.0.1:202 PLAY OK\r\n
[2026-04-05 09:07:53.902] [info]    Received message from 127.0.0.1: MIXER 2-10 ANCHOR 0 0\r\n
[2026-04-05 09:07:53.905] [info]    Sent message to 127.0.0.1:202 MIXER OK\r\n
[2026-04-05 09:07:53.905] [info]    Received message from 127.0.0.1: MIXER 2-10 FILL 0 0 1 1 0\r\n
[2026-04-05 09:07:53.906] [info]    Sent message to 127.0.0.1:202 MIXER OK\r\n
[2026-04-05 09:07:53.909] [info]    Received message from 127.0.0.1: MIXER 2-10 ROTATION 0 0\r\n
[2026-04-05 09:07:53.909] [info]    Sent message to 127.0.0.1:202 MIXER OK\r\n
[2026-04-05 09:07:53.910] [info]    Received message from 127.0.0.1: MIXER 2-10 OPACITY 1 0\r\n
[2026-04-05 09:07:53.910] [info]    Sent message to 127.0.0.1:202 MIXER OK\r\n
[2026-04-05 09:07:53.912] [info]    Received message from 127.0.0.1: MIXER 2-10 KEYER 0\r\n
[2026-04-05 09:07:53.912] [info]    Sent message to 127.0.0.1:202 MIXER OK\r\n
[2026-04-05 09:07:53.915] [info]    Received message from 127.0.0.1: MIXER 2 COMMIT\r\n
[2026-04-05 09:07:53.916] [info]    Sent message to 127.0.0.1:202 MIXER OK\r\n
[2026-04-05 09:07:53.940] [warning] [ffmpeg] [Parsed_amerge_0 @ 0x712a0c20bac0] No channel layout for input 1
[2026-04-05 09:07:53.940] [warning] 
[2026-04-05 09:07:53.941] [warning] [ffmpeg] [Parsed_amerge_0 @ 0x712a0c20bac0] Input channel layouts overlap: output layout will be determined by the number of distinct input channels
[2026-04-05 09:07:53.941] [warning] 
[2026-04-05 09:07:54.006] [info]    ffmpeg[media/PiekloKobiet_S01E01_Master_178_R709_PL-XX_20DFX_HD_25fps_HAP_20260210.mov|26/171024] Destroyed.
[2026-04-05 09:07:54.006] [warning] ffmpeg[PIEKLOKOBIET_S01E01_MASTER_178_R709_PL-XX_20DFX_HD_25FPS_HAP_20260210|0.0000/2850.4000] Latency: 7
[2026-04-05 09:07:56.472] [info]    Received message from 127.0.0.1: THUMBNAIL RETRIEVE LED-GRID-12288X1280\r\n
[2026-04-05 09:07:56.481] [info]    Sent more than 512 bytes to 127.0.0.1
[2026-04-05 09:07:56.493] [info]    Received message from 127.0.0.1: THUMBNAIL RETRIEVE LED-GRID-3584X1408\r\n
[2026-04-05 09:07:56.509] [info]    Sent more than 512 bytes to 127.0.0.1
[2026-04-05 09:08:03.434] [info]    Received message from 127.0.0.1: PLAY 2-10 LED-GRID-3584X1408\r\n
[2026-04-05 09:08:03.503] [info]    image_producer[media/led-grid-3584x1408.png] Initialized
[2026-04-05 09:08:03.503] [info]    Sent message to 127.0.0.1:202 PLAY OK\r\n
[2026-04-05 09:08:03.503] [info]    Received message from 127.0.0.1: MIXER 2-10 ANCHOR 0 0\r\n
[2026-04-05 09:08:03.503] [info]    Sent message to 127.0.0.1:202 MIXER OK\r\n
[2026-04-05 09:08:03.503] [info]    Received message from 127.0.0.1: MIXER 2-10 FILL -0.11675047596198496 0.2216948438359934 1 1 0\r\n
[2026-04-05 09:08:03.504] [info]    Sent message to 127.0.0.1:202 MIXER OK\r\n
[2026-04-05 09:08:03.504] [info]    Received message from 127.0.0.1: MIXER 2-10 ROTATION 0 0\r\n
[2026-04-05 09:08:03.504] [info]    Sent message to 127.0.0.1:202 MIXER OK\r\n
[2026-04-05 09:08:03.504] [info]    Received message from 127.0.0.1: MIXER 2-10 OPACITY 1 0\r\n
[2026-04-05 09:08:03.504] [info]    Sent message to 127.0.0.1:202 MIXER OK\r\n
[2026-04-05 09:08:03.504] [info]    Received message from 127.0.0.1: MIXER 2-10 KEYER 0\r\n
[2026-04-05 09:08:03.504] [info]    Sent message to 127.0.0.1:202 MIXER OK\r\n
[2026-04-05 09:08:03.504] [info]    Received message from 127.0.0.1: MIXER 2 COMMIT\r\n
[2026-04-05 09:08:03.504] [info]    Sent message to 127.0.0.1:202 MIXER OK\r\n
[2026-04-05 09:08:03.505] [info]    ffmpeg[media/PiekloKobiet_S01E01_Master_178_R709_PL-XX_20DFX_HD_25fps_HAP_20260210.mov|569/171024] Destroyed.
[2026-04-05 09:08:03.532] [info]    Received message from 127.0.0.1: PLAY 2-11 0-POZYTYWNI_CZYSTY_1_1 LOOP\r\n
[2026-04-05 09:08:03.533] [info]    Sent message to 127.0.0.1:202 PLAY OK\r\n
[2026-04-05 09:08:03.533] [info]    Received message from 127.0.0.1: MIXER 2-11 ANCHOR 0 0\r\n
[2026-04-05 09:08:03.533] [info]    Sent message to 127.0.0.1:202 MIXER OK\r\n
[2026-04-05 09:08:03.533] [info]    Received message from 127.0.0.1: MIXER 2-11 FILL 0.13420594654400553 0.2547519373278221 0.6996604415248732 0.6996604415248732 0\r\n
[2026-04-05 09:08:03.533] [info]    Sent message to 127.0.0.1:202 MIXER OK\r\n
[2026-04-05 09:08:03.533] [info]    Received message from 127.0.0.1: MIXER 2-11 ROTATION 0 0\r\n
[2026-04-05 09:08:03.533] [info]    Sent message to 127.0.0.1:202 MIXER OK\r\n
[2026-04-05 09:08:03.533] [info]    Received message from 127.0.0.1: MIXER 2-11 OPACITY 1 0\r\n
[2026-04-05 09:08:03.533] [info]    Sent message to 127.0.0.1:202 MIXER OK\r\n
[2026-04-05 09:08:03.533] [info]    Received message from 127.0.0.1: MIXER 2-11 KEYER 0\r\n
[2026-04-05 09:08:03.533] [info]    Sent message to 127.0.0.1:202 MIXER OK\r\n
[2026-04-05 09:08:03.533] [info]    Received message from 127.0.0.1: MIXER 2 COMMIT\r\n
[2026-04-05 09:08:03.533] [info]    Sent message to 127.0.0.1:202 MIXER OK\r\n
[2026-04-05 09:08:03.573] [warning] ffmpeg[0-POZYTYWNI_CZYSTY_1_1|0.0000/15.0333] Latency: 2
[2026-04-05 09:08:03.589] [info]    ffmpeg[media/0-Pozytywni_Czysty_1_1.mov|231/902] Destroyed.
[2026-04-05 09:08:06.215] [info]    Received message from 127.0.0.1: STOP 2-11\r\n
[2026-04-05 09:08:06.216] [info]    Sent message to 127.0.0.1:202 STOP OK\r\n
[2026-04-05 09:08:06.216] [info]    ffmpeg[media/0-Pozytywni_Czysty_1_1.mov|158/902] Destroyed.
[2026-04-05 09:08:06.217] [info]    Received message from 127.0.0.1: MIXER 2-11 CLEAR\r\n
[2026-04-05 09:08:06.218] [info]    Sent message to 127.0.0.1:202 MIXER OK\r\n
[2026-04-05 09:08:06.243] [info]    Received message from 127.0.0.1: PLAY 2-10 PIEKLOKOBIET_S01E01_MASTER_178_R709_PL-XX_20DFX_HD_25FPS_HAP_20260210\r\n
[2026-04-05 09:08:06.246] [info]    Sent message to 127.0.0.1:202 PLAY OK\r\n
[2026-04-05 09:08:06.247] [info]    Received message from 127.0.0.1: MIXER 2-10 ANCHOR 0 0\r\n
[2026-04-05 09:08:06.247] [info]    Sent message to 127.0.0.1:202 MIXER OK\r\n
[2026-04-05 09:08:06.248] [info]    Received message from 127.0.0.1: MIXER 2-10 FILL 0 0 1 1 0\r\n
[2026-04-05 09:08:06.248] [info]    Sent message to 127.0.0.1:202 MIXER OK\r\n
[2026-04-05 09:08:06.248] [info]    Received message from 127.0.0.1: MIXER 2-10 ROTATION 0 0\r\n
[2026-04-05 09:08:06.248] [info]    Sent message to 127.0.0.1:202 MIXER OK\r\n
[2026-04-05 09:08:06.248] [info]    Received message from 127.0.0.1: MIXER 2-10 OPACITY 1 0\r\n
[2026-04-05 09:08:06.249] [info]    Sent message to 127.0.0.1:202 MIXER OK\r\n
[2026-04-05 09:08:06.250] [info]    Received message from 127.0.0.1: MIXER 2-10 KEYER 0\r\n
[2026-04-05 09:08:06.250] [info]    Sent message to 127.0.0.1:202 MIXER OK\r\n
[2026-04-05 09:08:06.250] [info]    Received message from 127.0.0.1: MIXER 2 COMMIT\r\n
[2026-04-05 09:08:06.251] [info]    Sent message to 127.0.0.1:202 MIXER OK\r\n
[2026-04-05 09:08:06.266] [warning] [ffmpeg] [Parsed_amerge_0 @ 0x7127cc20b840] No channel layout for input 1
[2026-04-05 09:08:06.266] [warning] 
[2026-04-05 09:08:06.266] [warning] [ffmpeg] [Parsed_amerge_0 @ 0x7127cc20b840] Input channel layouts overlap: output layout will be determined by the number of distinct input channels
[2026-04-05 09:08:06.266] [warning] 
[2026-04-05 09:08:06.339] [warning] ffmpeg[PIEKLOKOBIET_S01E01_MASTER_178_R709_PL-XX_20DFX_HD_25FPS_HAP_20260210|0.0000/2850.4000] Latency: 6
[2026-04-05 09:08:06.339] [info]    image_producer[media/led-grid-3584x1408.png] Destroyed.
casparcg@serwer:~$ 
