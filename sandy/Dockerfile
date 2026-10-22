FROM nginx:1.27-alpine
COPY cloud-run-nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/index.html
EXPOSE 8080
CMD ["nginx","-g","daemon off;"]
