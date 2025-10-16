# Estágio 1: Instalar dependências
FROM node:20-alpine AS deps
WORKDIR /app

# Copia apenas o package.json para aproveitar o cache do Docker
COPY package.json ./

# Instala as dependências de produção
RUN npm install --omit=dev

# Estágio 2: Construir a imagem final
FROM node:20-alpine AS runner
WORKDIR /app

# Copia as dependências instaladas do estágio anterior
COPY --from=deps /app/node_modules ./node_modules

# Copia o código da aplicação
COPY . .

# Expõe a porta que a aplicação usa
EXPOSE 3000

# Comando para iniciar a aplicação
CMD [ "npm", "start" ]