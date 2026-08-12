#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <arpa/inet.h>
#include <fcntl.h>
#include <sys/stat.h>

#define PORT 8080
#define BUFFER_SIZE 8192
#define WEB_ROOT "./www"

void handle_client(int client_socket) {
    char buffer[BUFFER_SIZE] = {0};
    
    // Read the HTTP request
    read(client_socket, buffer, BUFFER_SIZE - 1);
    printf("\n--- Received HTTP Request ---\n%s\n-----------------------------\n", buffer);

    // Parse the GET request to find the requested file
    char method[16], path[256], protocol[16];
    sscanf(buffer, "%s %s %s", method, path, protocol);

    if (strcmp(method, "GET") != 0) {
        char *response = "HTTP/1.1 405 Method Not Allowed\r\n\r\nOnly GET method is supported.";
        send(client_socket, response, strlen(response), 0);
        close(client_socket);
        return;
    }

    // Default to index.html if root path is requested
    if (strcmp(path, "/") == 0) {
        strcpy(path, "/index.html");
    }

    // Construct the full file path
    char filepath[512];
    snprintf(filepath, sizeof(filepath), "%s%s", WEB_ROOT, path);

    // Open the requested file
    int file_fd = open(filepath, O_RDONLY);
    if (file_fd < 0) {
        // File not found (404)
        char *response = "HTTP/1.1 404 Not Found\r\nContent-Type: text/html\r\n\r\n<h1>404 - File Not Found</h1>";
        send(client_socket, response, strlen(response), 0);
        printf("Served 404 Not Found for %s\n", filepath);
    } else {
        // File found (200 OK)
        struct stat file_stat;
        fstat(file_fd, &file_stat);
        
        // Send HTTP Headers
        char headers[256];
        snprintf(headers, sizeof(headers), "HTTP/1.1 200 OK\r\nContent-Length: %ld\r\nContent-Type: text/html\r\nConnection: close\r\n\r\n", file_stat.st_size);
        send(client_socket, headers, strlen(headers), 0);

        // Send the file contents
        int bytes_read;
        while ((bytes_read = read(file_fd, buffer, BUFFER_SIZE)) > 0) {
            send(client_socket, buffer, bytes_read, 0);
        }
        close(file_fd);
        printf("Successfully served %s\n", filepath);
    }

    close(client_socket);
}

int main() {
    int server_fd, new_socket;
    struct sockaddr_in address;
    int opt = 1;
    int addrlen = sizeof(address);

    // Create the web root directory if it doesn't exist
    mkdir(WEB_ROOT, 0755);
    
    // Create a default index.html if it doesn't exist
    FILE *index_file = fopen("./www/index.html", "a");
    if (index_file != NULL) {
        long size = ftell(index_file);
        if (size == 0) {
            fprintf(index_file, "<!DOCTYPE html>\n<html>\n<head>\n<title>My Web OS Site</title>\n</head>\n<body>\n<h1>Welcome to my C Web Server!</h1>\n<p>This website is successfully hosted directly from the native C server in Ubuntu.</p>\n</body>\n</html>\n");
        }
        fclose(index_file);
    }

    // 1. Create socket file descriptor (IPv4, TCP)
    if ((server_fd = socket(AF_INET, SOCK_STREAM, 0)) == 0) {
        perror("socket failed");
        exit(EXIT_FAILURE);
    }

    // 2. Attach socket to the port 8080 forcefully
    if (setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR | SO_REUSEPORT, &opt, sizeof(opt))) {
        perror("setsockopt");
        exit(EXIT_FAILURE);
    }
    
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = INADDR_ANY;
    address.sin_port = htons(PORT);

    // 3. Bind the socket
    if (bind(server_fd, (struct sockaddr *)&address, sizeof(address)) < 0) {
        perror("bind failed");
        exit(EXIT_FAILURE);
    }

    // 4. Listen for incoming connections
    if (listen(server_fd, 10) < 0) {
        perror("listen");
        exit(EXIT_FAILURE);
    }
    
    printf("Native C HTTP Web Server is running and listening on port %d...\n", PORT);
    printf("Serving files from the '%s' directory.\n", WEB_ROOT);
    printf("Try running 'curl http://localhost:%d' in another terminal.\n\n", PORT);

    // 5. Infinite loop to accept multiple clients
    while(1) {
        if ((new_socket = accept(server_fd, (struct sockaddr *)&address, (socklen_t*)&addrlen)) < 0) {
            perror("accept");
            continue;
        }
        
        handle_client(new_socket);
    }

    shutdown(server_fd, SHUT_RDWR);
    return 0;
}
