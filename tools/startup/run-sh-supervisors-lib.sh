# Count run.sh supervisors (source, do not execute). Shared by the stick QA and verify-highascg-stick-boot.sh.
# shellcheck shell=bash
# WO-832: count run.sh SUPERVISORS, not processes whose cmdline mentions run.sh. run.sh forks sub-shells
# (watchdog/pipe children) that carry the identical cmdline with the supervisor as parent, so the old
# `pgrep -f run\.sh | wc -l` reported 2 on a healthy box ("multiple run.sh supervisors").
# ST_PS_CMD is a test seam: any command printing `pid ppid args…` lines (default: ps -eo pid=,ppid=,args=).
st_count_run_sh_supervisors() {
	local ps_cmd="${ST_PS_CMD:-ps -eo pid=,ppid=,args=}"
	# shellcheck disable=SC2086
	$ps_cmd 2>/dev/null | awk '
		{
			pid = $1; ppid = $2
			$1 = ""; $2 = ""; sub(/^ +/, "")
			args[pid] = $0; par[pid] = ppid
		}
		END {
			n = 0
			for (p in args) {
				if (args[p] !~ /^(\/usr\/bin\/|\/bin\/)?(sh|bash|dash) +[^ ]*run\.sh( |$)/) continue
				if ((par[p] in args) && args[par[p]] == args[p]) continue
				n++
			}
			print n
		}'
}
