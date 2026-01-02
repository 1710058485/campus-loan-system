# Build stage
FROM public.ecr.aws/docker/library/node:18-alpine as build

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

ARG VITE_INVENTORY_API_URL
ARG VITE_LOAN_API_URL
ENV VITE_INVENTORY_API_URL=$VITE_INVENTORY_API_URL
ENV VITE_LOAN_API_URL=$VITE_LOAN_API_URL

RUN npm run build

# Production stage
FROM public.ecr.aws/nginx/nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
