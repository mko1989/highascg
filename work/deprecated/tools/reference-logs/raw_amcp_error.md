INFO 1
VERSION
INFO CONFIG
CINF led-grid-5120x1024.png
CG 1-998 UPDATE 0 "{\"width\":50,\"color\":\"#e63946\",\"radius\":0,\"opacity\":1,\"side\":\"inside\",\"intensity\":50,\"enabled\":true,\"fadeDuration\":25,\"artnetPatch\":{\"startChannel\":1,\"universe\":0},\"inner\":{\"l\":0,\"t\":0,\"w\":1,\"h\":1}}"
LOADBG 1-10 led-grid-5120x1024.png MIX 25 linear AUTO
MIXER 1-10 FILL 0.03855132236799197 0.06139210015073118 0.9170134400099101 0.30933786707713434 25 DEFER
MIXER 1 COMMIT
PLAY 1-10
MIXER 1-110 OPACITY 0 25 linear
MIXER 1 COMMIT
CINF LED-GRID-3840X1024
CG 2-998 UPDATE 0 "{\"width\":50,\"color\":\"#e63946\",\"radius\":0,\"opacity\":1,\"side\":\"inside\",\"intensity\":50,\"enabled\":true,\"fadeDuration\":25,\"artnetPatch\":{\"startChannel\":1,\"universe\":0},\"inner\":{\"l\":0,\"t\":0,\"w\":1,\"h\":1}}"
MIXER 2-110 CLEAR
LOADBG 2-110 LED-GRID-3840X1024
MIXER 2-110 FILL -0.8377028683190291 0.4603643140479707 2.109375 1 0
MIXER 2 COMMIT
PLAY 2-110
STOP 2-10
MIXER 2-10 CLEAR
MIXER 2 COMMIT
STOP 1-110
MIXER 1-110 CLEAR
MIXER 1 COMMIT
CINF "422 TEST 2"
CG 1-998 UPDATE 0 "{\"width\":50,\"color\":\"#e63946\",\"radius\":0,\"opacity\":1,\"side\":\"inside\",\"intensity\":50,\"enabled\":true,\"fadeDuration\":25,\"artnetPatch\":{\"startChannel\":1,\"universe\":0},\"inner\":{\"l\":0,\"t\":0,\"w\":1,\"h\":1}}"
LOADBG 1-10 "422 TEST 2" MIX 25 linear AUTO
MIXER 1-10 FILL 0.502853557748848 0.06690557576339634 0.4406099966249742 0.4406099966249742 25 DEFER
MIXER 1 COMMIT
PLAY 1-10
CINF led-grid-5120x1024.png
CG 2-998 UPDATE 0 "{\"width\":50,\"color\":\"#e63946\",\"radius\":0,\"opacity\":1,\"side\":\"inside\",\"intensity\":50,\"enabled\":true,\"fadeDuration\":25,\"artnetPatch\":{\"startChannel\":1,\"universe\":0},\"inner\":{\"l\":0,\"t\":0,\"w\":1,\"h\":1}}"
MIXER 2-10 CLEAR
LOADBG 2-10 led-grid-5120x1024.png
MIXER 2-10 FILL 0.03855132236799197 0.06139210015073118 0.9170134400099101 0.30933786707713434 0
MIXER 2 COMMIT
PLAY 2-10
STOP 2-110
MIXER 2-110 CLEAR
MIXER 2 COMMIT
STOP 1-10
MIXER 1-10 CLEAR
MIXER 1 COMMIT
CINF LED-GRID-3840X1024
CG 1-998 UPDATE 0 "{\"width\":50,\"color\":\"#e63946\",\"radius\":0,\"opacity\":1,\"side\":\"inside\",\"intensity\":50,\"enabled\":true,\"fadeDuration\":25,\"artnetPatch\":{\"startChannel\":1,\"universe\":0},\"inner\":{\"l\":0,\"t\":0,\"w\":1,\"h\":1}}"
LOADBG 1-10 LED-GRID-3840X1024 MIX 25 linear AUTO
MIXER 1-10 FILL -0.8377028683190291 0.4603643140479707 2.109375 1 25 DEFER
MIXER 1 COMMIT
PLAY 1-10
MIXER 1-110 OPACITY 0 25 linear
MIXER 1 COMMIT
CINF "422 TEST 2"
CG 2-998 UPDATE 0 "{\"width\":50,\"color\":\"#e63946\",\"radius\":0,\"opacity\":1,\"side\":\"inside\",\"intensity\":50,\"enabled\":true,\"fadeDuration\":25,\"artnetPatch\":{\"startChannel\":1,\"universe\":0},\"inner\":{\"l\":0,\"t\":0,\"w\":1,\"h\":1}}"
MIXER 2-110 CLEAR
LOADBG 2-110 "422 TEST 2"
MIXER 2-110 FILL 0.502853557748848 0.06690557576339634 0.4406099966249742 0.4406099966249742 0
MIXER 2 COMMIT
PLAY 2-110
STOP 2-10
MIXER 2-10 CLEAR
MIXER 2 COMMIT
STOP 1-110
MIXER 1-110 CLEAR
MIXER 1 COMMIT
CINF led-grid-5120x1024.png
CG 1-998 UPDATE 0 "{\"width\":50,\"color\":\"#e63946\",\"radius\":0,\"opacity\":1,\"side\":\"inside\",\"intensity\":50,\"enabled\":true,\"fadeDuration\":25,\"artnetPatch\":{\"startChannel\":1,\"universe\":0},\"inner\":{\"l\":0,\"t\":0,\"w\":1,\"h\":1}}"
LOADBG 1-10 led-grid-5120x1024.png MIX 25 linear AUTO
MIXER 1-10 FILL 0.03855132236799197 0.06139210015073118 0.8700127511544403 0.30933786707713434 25 DEFER
MIXER 1 COMMIT
PLAY 1-10
MIXER 1-20 OPACITY 0 25 linear
MIXER 1 COMMIT
CINF TESTOWE/BIG_BUCK_BUNNY_1080P24
CINF TESTOWE/FOREST_JESTER-DV
CG 1-998 UPDATE 0 "{\"width\":50,\"color\":\"#e63946\",\"radius\":0,\"opacity\":1,\"side\":\"inside\",\"intensity\":50,\"enabled\":true,\"fadeDuration\":25,\"artnetPatch\":{\"startChannel\":1,\"universe\":0},\"inner\":{\"l\":0,\"t\":0,\"w\":1,\"h\":1}}"
LOADBG 1-10 TESTOWE/BIG_BUCK_BUNNY_1080P24 MIX 25 linear AUTO
LOADBG 1-20 TESTOWE/FOREST_JESTER-DV LOOP MIX 25 linear AUTO
MIXER 1-20 FILL 0.19846285853987863 0.16111804707374716 0.5625 0.6666666666666666 25 DEFER
MIXER 1-20 CROP 0.2 0.1 0.9 0.9 0 DEFER
MIXER 1 COMMIT
PLAY 1-10
PLAY 1-20
MIXER 1-110 OPACITY 0 25 linear
MIXER 1-120 OPACITY 0 25 linear
MIXER 1 COMMIT
