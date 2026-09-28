# Image simple pour le prototype : une seule couche pip install, pas de multi-stage
# build. Pas d'optimisation de taille d'image ici, la démo tourne en local.
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
# torch (dépendance transitive de sentence-transformers) installé à part, AVANT
# le reste, depuis l'index CPU officiel de PyTorch : laissé à la résolution
# normale de pip, il installe par défaut la variante CUDA — des centaines de Mo
# de paquets nvidia-* (cudnn, cublas, nccl...) totalement inutiles dans ce
# conteneur, qui n'a pas de GPU. Une fois torch CPU déjà satisfait, l'install
# de requirements.txt qui suit ne le retélécharge pas.
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# --reload : confort de dev (le code est monté en volume par docker-compose.yml).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
