.PHONY: all clean kernel tcp go_wifi

all: kernel tcp go_wifi

kernel:
	$(MAKE) -C agents/c

tcp:
	gcc -o agents/c/web_server agents/c/tcp_server.c

go_wifi:
	cd agents/go/wifi_scanner && go build -o wifi.exe wifi.go

clean:
	$(MAKE) -C agents/c clean
	rm -f agents/c/web_server
	rm -f agents/go/wifi_scanner/wifi.exe
