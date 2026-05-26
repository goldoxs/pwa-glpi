FROM nginx:stable-alpine
COPY . /usr/share/nginx/html
EXPOSE 8085
CMD ["nginx", "-g", "daemon off;"]
