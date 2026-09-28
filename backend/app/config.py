"""Configuration centralisée, lue une seule fois depuis les variables d'environnement.

Un seul endroit pour dire "d'où viennent les secrets et paramètres" : si on
m'interroge en entretien sur où vit la clé API, la réponse est ce fichier.
pydantic-settings lit automatiquement les variables d'environnement (et un
fichier .env local si présent), et valide qu'elles sont bien présentes au
démarrage plutôt que d'échouer plus tard au premier appel API.
"""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    anthropic_api_key: str
    database_url: str

    model_config = {"env_file": ".env"}


# Instance unique importée partout ailleurs (app.state, routers, services).
# Pas besoin d'un pattern plus complexe (dependency injection framework, etc.)
# pour un prototype à un seul environnement de déploiement.
settings = Settings()
