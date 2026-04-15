
# Satellite Constellation Simulator

Интерактивный симулятор спутниковой группировки для визуализации орбит и анализа покрытия.

---

## Установка

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate      # Linux / Mac
venv\Scripts\activate         # Windows

pip install fastapi uvicorn numpy
```

---
### Запуск backend
```bash
cd backend
uvicorn main:app --reload
```

---
### Запуск frontend
```bash
cd frontend
python -m http.server 8080
```

Открыть в браузере:
http://localhost:8080