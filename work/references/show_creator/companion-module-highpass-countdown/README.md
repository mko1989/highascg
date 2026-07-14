# Companion Module: Highpass Countdown

This module provides a simple countdown timer that can be displayed in a web browser and controlled from Companion.

## Features

- Set a countdown time (HH:MM:SS).
- Start, pause, and stop the timer.
- Add or subtract time from the current countdown.
- Display the timer in a web browser using Companion's built-in HTTP handler.
- Change the color of the timer based on its state (running, paused, stopped) and time remaining (amber and red warnings).
- Set top, bottom, and middle auxiliary text.
- Show the internal time on the web page.
- Speech synthesis support with configurable triggers and settings.

## Configuration

1.  **HTTP Handler Information**: This module uses Companion's built-in HTTP handler. Access the web interface at: `/instance/[INSTANCE_NAME]/`
2.  **Show Internal Time**: Display the computer's internal time on the web page.
3.  **Time Corner**: Choose the corner of the screen to display the internal time.
4.  **Hide Timer**: Hide the main timer and show a third aux field instead.
5.  **Amber Time (seconds)**: The timer will turn amber when the remaining time is less than or equal to this value.
6.  **Red Time (seconds)**: The timer will turn red when the remaining time is less than or equal to this value.
7.  **Timer Font Size (vw)**: The font size of the timer as a percentage of the viewport width.
8.  **Aux Font Size (vw)**: The font size of the auxiliary text as a percentage of the viewport width.
9.  **Speech Synthesis**: Enable speech synthesis with configurable field, trigger, rate, pitch, and volume.

## Web Interface

To view the timer, open a web browser and navigate to `http://<companion-ip>:<companion-port>/instance/[INSTANCE_NAME]/`. Replace `[INSTANCE_NAME]` with the name you gave to your timer instance in Companion.

The web interface will automatically poll for updates every 500ms to provide real-time timer display.

## API Endpoints

The module provides several HTTP endpoints for external control:

- `GET /state` - Get current timer state as JSON
- `GET /config` - Get current configuration as JSON
- `GET /control?action=start|pause|stop` - Control timer
- `GET /set?time=HH:MM:SS` - Set timer
- `GET /add?time=HH:MM:SS` - Add time
- `GET /subtract?time=HH:MM:SS` - Subtract time
- `GET /setaux?field=top|bottom|middle&text=...` - Set aux text
- `GET /speak?field=timer|top_aux|bottom_aux|middle_aux|custom&custom_text=...` - Trigger speech

## Presets

The module comes with a number of presets to get you started:

-   **Timer Display**: A button that shows the current timer value and changes color based on the state.
-   **Start/Pause/Stop Timer**: Buttons to control the timer.
-   **Set Timer**: Buttons to set the timer to common values (1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100, 105, 110, 115, 120 minutes).
-   **Add/Subtract Minute**: Buttons to add or subtract one minute from the timer.
-   **Set Aux Text**: Buttons to set top, bottom, and middle auxiliary text.
-   **Speak Text**: Button to trigger speech synthesis.

## Actions

- **Set Timer**: Set the timer to a specific time (HH:MM:SS format)
- **Control Timer**: Start, pause, or stop the timer
- **Add Time**: Add time to the current timer
- **Subtract Time**: Subtract time from the current timer
- **Set Aux Text**: Set top, bottom, or middle auxiliary text
- **Speak Text**: Trigger speech synthesis for a specific field or custom text

## Feedbacks

- **Timer State Color**: Change button color based on timer state (running/paused/stopped) and time remaining
- **Is Selected Time**: Change button style if the time matches the last set time 