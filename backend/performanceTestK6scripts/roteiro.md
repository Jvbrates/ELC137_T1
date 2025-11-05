# 🧩 Projeto de Sistema Distribuído

**DISCIPLINA:** Sistemas de Informação Distribuídos

**TRABALHO 1:** Projeto de Sistema Distribuído

**PARTE 2:** Avaliação de Desempenho

---

## 🎯 Objetivo

Avaliar a **arquitetura proposta** do sistema bancário distribuído através de **testes de desempenho** e **carga simulada**.

---

## ⚙️ Grafana k6: a ferramenta utilizada

**k6** é uma ferramenta **leve e moderna e open-source** de teste de carga e performance, sendo uma **alternativa ao Apache JMeter**.

### ✅ Principais Características

* Permite escrever scripts de teste em **JavaScript (ES6)**.
* Desenvolvido pela **Grafana Labs**.


## 🧰 Instalação e Verificação

### 🔹 Instalar o k6

### 💻 Recursos Adicionais

* **Documentação Oficial:** [https://k6.io/docs/](https://k6.io/docs/)
* **K6 Getting Started:** [https://k6.io/docs/getting-started/running-k6/](https://k6.io/docs/getting-started/running-k6/)
* **Tipos de Teste com k6:** [https://k6.io/docs/test-types/](https://k6.io/docs/test-types/)

---

### 🔹 Verificar a versão instalada
No terminal Linux, rode o comando:

```bash
k6 version
```

### 🔹 Obter ajuda sobre os comandos

```bash
k6 --help
```

---

## 🧪 Criação do Script de Teste

1. Na pasta raiz, crie um arquivo chamado `script-test.js`.
2. Insira o seguinte exemplo básico:

```javascript
import http from 'k6/http';
import { sleep } from 'k6';

export const options = {
  vus: 50, // 50 usuários virtuais simultâneos
  duration: '30s', // duração do teste
};

export default function () {
  http.get('http://localhost:3000/'); // URL base do backend
  sleep(1);
}
```

3. Para executar o teste, rode:

```bash
k6 run script-test.js
```

---

Cenário,Função leituraFunc (GET),Função escritaFunc (POST)
A,50 VUs,50 VUs
B,75 VUs,25 VUs
C,25 VUs,75 VUs

## 📊 Interpretação dos Resultados

Após a execução, o terminal exibirá métricas como:

* **Requests/s (taxa de requisições)**
* **Tempo médio de resposta**
* **Erro (%)**

Esses dados permitem identificar gargalos e avaliar o comportamento do sistema sob diferentes cargas de usuários.

---

## 🧠 Conclusão

O uso do **k6** oferece uma forma prática, rápida e moderna de avaliar o desempenho de aplicações distribuídas.
A ferramenta se integra facilmente a pipelines de CI/CD e fornece métricas valiosas para otimização da infraestrutura e da aplicação.