from datetime import datetime
import os
import re

date_str = datetime.now().strftime("%Y-%m-%d")
log_path = f"/home/casparcg/highascg/log/caspar_{date_str}.log"
timestamp_file = "/home/casparcg/highascg/tools/log_timestamp"
output_path = "/home/casparcg/highascg/tools/extracted_amcp.md"

# Create timestamp file if it doesn't exist
if not os.path.exists(timestamp_file):
    default_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S.000")
    with open(timestamp_file, "w") as f:
        f.write(default_time)
    print(f"Created default timestamp file {timestamp_file} with: {default_time}")

# Read target timestamp
with open(timestamp_file, "r") as f:
    target_timestamp_str = f.read().strip()

# Parse
if len(target_timestamp_str) <= 12:
    target_timestamp_str = f"{date_str} {target_timestamp_str}"

try:
    target_timestamp = datetime.strptime(target_timestamp_str, "%Y-%m-%d %H:%M:%S.%f")
except ValueError as e:
    print(f"Error parsing timestamp '{target_timestamp_str}': {e}")
    exit(1)

print(f"Filtering logs from: {target_timestamp}")

if not os.path.exists(log_path):
    print(f"Error: Log file {log_path} not found.")
    exit(1)

output_lines = []
with open(log_path, "r") as f:
    for line in f:
        if "Received message from" in line:
            match = re.search(r"\[(.*?)\] \[info\]\s+Received message from 127.0.0.1: (.*)", line)
            if match:
                log_time_str = match.group(1)
                try:
                    log_time = datetime.strptime(log_time_str, "%Y-%m-%d %H:%M:%S.%f")
                    if log_time >= target_timestamp:
                        message = match.group(2).replace("\\r\\n", "").strip()
                        output_lines.append(f"[{log_time_str}] {message}")
                except ValueError:
                    continue

with open(output_path, "w") as f:
    f.write("\n".join(output_lines) + "\n")

print(f"Extracted {len(output_lines)} lines to {output_path}")
