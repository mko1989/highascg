/*
 * Draw throbber-boot frames in the top-right corner of /dev/fb0 while leaving
 * the rest of the framebuffer (nosplash dmesg console) untouched.
 */
#include <errno.h>
#include <fcntl.h>
#include <linux/fb.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <unistd.h>

#define FRAME_INTERVAL_MS 200
#define DEFAULT_MARGIN 20
#define MAX_FRAMES 16
#define MAX_PATH 512

static volatile sig_atomic_t running = 1;

static void on_signal(int sig) {
	(void)sig;
	running = 0;
}

static uint32_t rgb_to_pixel(uint8_t r, uint8_t g, uint8_t b,
			     const struct fb_var_screeninfo *v) {
	uint32_t pixel = 0;

	if (v->red.length)
		pixel |= ((uint32_t)(r >> (8 - v->red.length)) << v->red.offset);
	if (v->green.length)
		pixel |= ((uint32_t)(g >> (8 - v->green.length)) << v->green.offset);
	if (v->blue.length)
		pixel |= ((uint32_t)(b >> (8 - v->blue.length)) << v->blue.offset);
	if (v->transp.length)
		pixel |= ((uint32_t)(0xff >> (8 - v->transp.length)) << v->transp.offset);

	return pixel;
}

static ssize_t read_all(int fd, void *buf, size_t len) {
	uint8_t *p = buf;
	size_t left = len;

	while (left > 0) {
		ssize_t n = read(fd, p, left);
		if (n < 0) {
			if (errno == EINTR)
				continue;
			return -1;
		}
		if (n == 0)
			return (ssize_t)(len - left);
		p += (size_t)n;
		left -= (size_t)n;
	}
	return (ssize_t)len;
}

typedef struct {
	int width;
	int height;
	uint8_t *rgb;
} Frame;

static void free_frame(Frame *frame) {
	free(frame->rgb);
	frame->rgb = NULL;
	frame->width = 0;
	frame->height = 0;
}

static int load_rgb_frame(const char *path, int width, int height, Frame *frame) {
	size_t bytes = (size_t)width * (size_t)height * 3;
	int fd;
	uint8_t *rgb;

	fd = open(path, O_RDONLY);
	if (fd < 0)
		return -1;

	rgb = malloc(bytes);
	if (!rgb) {
		close(fd);
		return -1;
	}

	if (read_all(fd, rgb, bytes) < 0) {
		free(rgb);
		close(fd);
		return -1;
	}
	close(fd);

	frame->width = width;
	frame->height = height;
	frame->rgb = rgb;
	return 0;
}

static void blit_rgb_top_right(uint8_t *fb, const struct fb_fix_screeninfo *finfo,
			       const struct fb_var_screeninfo *vinfo,
			       const Frame *frame, int margin) {
	const int x0 = (int)vinfo->xres - frame->width - margin;
	const int y0 = margin;
	const int bytes_per_pixel = (int)vinfo->bits_per_pixel / 8;
	uint32_t *dst32;
	uint8_t *dst8;
	int y, x;

	if (x0 < 0 || y0 < 0)
		return;

	for (y = 0; y < frame->height; y++) {
		const uint8_t *src = frame->rgb + (size_t)y * (size_t)frame->width * 3;
		uint8_t *row = fb + (size_t)(y0 + y) * finfo->line_length;

		for (x = 0; x < frame->width; x++) {
			const uint8_t r = src[x * 3 + 0];
			const uint8_t g = src[x * 3 + 1];
			const uint8_t b = src[x * 3 + 2];
			const uint32_t pixel = rgb_to_pixel(r, g, b, vinfo);
			const size_t off = (size_t)(x0 + x) * (size_t)bytes_per_pixel;

			if (bytes_per_pixel == 4) {
				dst32 = (uint32_t *)(row + off);
				*dst32 = pixel;
			} else if (bytes_per_pixel == 2) {
				dst8 = row + off;
				dst8[0] = (uint8_t)(pixel & 0xff);
				dst8[1] = (uint8_t)((pixel >> 8) & 0xff);
			} else if (bytes_per_pixel == 3) {
				dst8 = row + off;
				dst8[0] = (uint8_t)(pixel & 0xff);
				dst8[1] = (uint8_t)((pixel >> 8) & 0xff);
				dst8[2] = (uint8_t)((pixel >> 16) & 0xff);
			}
		}
	}
}

static void usage(const char *prog) {
	fprintf(stderr,
		"Usage: %s --frames-dir DIR --width W --height H --count N [--margin M] [--fb PATH] [--interval-ms MS]\n",
		prog);
}

int main(int argc, char **argv) {
	const char *frames_dir = NULL;
	const char *fb_path = "/dev/fb0";
	char path[MAX_PATH];
	int width = 0;
	int height = 0;
	int count = 0;
	int margin = DEFAULT_MARGIN;
	int interval_ms = FRAME_INTERVAL_MS;
	int fd = -1;
	int i;
	int opt;
	Frame frames[MAX_FRAMES];
	struct fb_var_screeninfo vinfo;
	struct fb_fix_screeninfo finfo;
	uint8_t *fb = MAP_FAILED;
	size_t fb_size;
	int frame_idx = 0;

	memset(frames, 0, sizeof(frames));
	signal(SIGTERM, on_signal);
	signal(SIGINT, on_signal);

	while ((opt = getopt(argc, argv, "d:w:h:c:m:f:i:")) != -1) {
		switch (opt) {
		case 'd':
			frames_dir = optarg;
			break;
		case 'w':
			width = atoi(optarg);
			break;
		case 'h':
			height = atoi(optarg);
			break;
		case 'c':
			count = atoi(optarg);
			break;
		case 'm':
			margin = atoi(optarg);
			break;
		case 'f':
			fb_path = optarg;
			break;
		case 'i':
			interval_ms = atoi(optarg);
			break;
		default:
			usage(argv[0]);
			return 2;
		}
	}

	if (!frames_dir || width <= 0 || height <= 0 || count <= 0 || count > MAX_FRAMES) {
		usage(argv[0]);
		return 2;
	}

	for (i = 0; i < count; i++) {
		snprintf(path, sizeof(path), "%s/throbber-%04d.rgb", frames_dir, i + 1);
		if (load_rgb_frame(path, width, height, &frames[i]) != 0) {
			fprintf(stderr, "failed to load %s: %s\n", path, strerror(errno));
			for (i = 0; i < count; i++)
				free_frame(&frames[i]);
			return 1;
		}
	}

	fd = open(fb_path, O_RDWR);
	if (fd < 0) {
		fprintf(stderr, "open %s: %s\n", fb_path, strerror(errno));
		for (i = 0; i < count; i++)
			free_frame(&frames[i]);
		return 1;
	}

	if (ioctl(fd, FBIOGET_VSCREENINFO, &vinfo) < 0 ||
	    ioctl(fd, FBIOGET_FSCREENINFO, &finfo) < 0) {
		fprintf(stderr, "fb ioctl: %s\n", strerror(errno));
		close(fd);
		for (i = 0; i < count; i++)
			free_frame(&frames[i]);
		return 1;
	}

	fb_size = finfo.smem_len;
	if (fb_size == 0)
		fb_size = (size_t)finfo.line_length * (size_t)vinfo.yres;

	fb = mmap(NULL, fb_size, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
	if (fb == MAP_FAILED) {
		fprintf(stderr, "mmap fb: %s\n", strerror(errno));
		close(fd);
		for (i = 0; i < count; i++)
			free_frame(&frames[i]);
		return 1;
	}

	while (running) {
		blit_rgb_top_right(fb, &finfo, &vinfo, &frames[frame_idx], margin);
		frame_idx = (frame_idx + 1) % count;
		usleep((useconds_t)interval_ms * 1000U);
	}

	munmap(fb, fb_size);
	close(fd);
	for (i = 0; i < count; i++)
		free_frame(&frames[i]);
	return 0;
}
