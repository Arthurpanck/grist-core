# Analyse de l'Intégration IA dans Grist-Core

## 1. Informations du Document Grist Transférées à l'Assistant IA

### 1.1 Structure de la Requête

Lorsqu'un utilisateur demande de l'assistance pour une formule, Grist envoie les données suivantes à l'API OpenAI :

#### **Données de Contexte**
- **Table ID** : Identifiant de la table concernée
- **Column ID** : Identifiant de la colonne pour laquelle la formule est demandée
- **Row ID** (optionnel) : Numéro de ligne pour l'évaluation de formule
- **Conversation ID** : Identifiant unique de la conversation
- **User Hash** : Hash SHA256 de l'ID utilisateur (non identifiant direct)

#### **Schéma Complet du Document**

Le système génère automatiquement un prompt contenant la structure complète des tables :

1. **Pour toutes les tables visibles** :
   - Nom de la table
   - Noms et types de toutes les colonnes visibles
   - Relations entre tables (Ref, RefList)
   - Méthodes `lookupRecords()` et `lookupOne()` avec leurs signatures

2. **Types de Colonnes Détectés** :
   - Types primitifs : `str`, `float`, `int`, `bool`, `datetime.date`, `datetime.datetime`
   - Types référence : `TableName` pour Ref, `list[TableName]` pour RefList
   - Types choix : `Literal["option1", "option2", ...]` pour Choice
   - Types analysés : Pour les colonnes "Any", le système analyse les valeurs actuelles pour déduire le type

3. **Structures de Lookup** :
   ```python
   class TableName:
       def lookupRecords(col1=None, col2=None, ..., sort_by=None) -> list[TableName]
       def lookupOne(col1=None, col2=None, ..., sort_by=None) -> TableName
   ```

#### **Évaluation de Formule Actuelle** (si demandé)

Quand `evaluateCurrentFormula` est activé :
- **Code de la formule** actuelle
- **Attributs accédés** pendant l'exécution (ex: `rec.column_name = value`)
- **Résultat ou erreur** de l'évaluation

#### **Historique de Conversation**

Les messages précédents de la conversation sont inclus pour maintenir le contexte.

### 1.2 Données NON Transférées (Respect de la Vie Privée)

- ❌ Contenu des cellules (sauf lors de l'évaluation explicite d'une formule)
- ❌ Identité réelle de l'utilisateur (seulement un hash)
- ❌ Nom du document
- ❌ Données sensibles des lignes

---

## 2. Les 2 Fonctions Clés de l'Assistant IA

### 2.1 Fonction #1 : `get_formula_prompt` (Python)

**Fichier** : `sandbox/grist/formula_prompt.py:156-167`

**Importance** : Cette fonction est le **cœur de l'intelligence contextuelle** de l'assistant. Elle génère le prompt système qui donne à l'IA une compréhension complète de la structure des données.

**Ce qu'elle fait** :
- Construit des classes Python représentant chaque table du document
- Inclut les types de colonnes, relations, et méthodes de lookup
- Génère la signature de la fonction à compléter avec le bon type de retour
- Peut être configurée pour inclure toutes les tables ou seulement celles référencées

**Exemple de sortie** :
```python
class Employees:
    def lookupRecords(name=None, department=None, sort_by=None) -> list[Employees]:
       ...
    def lookupOne(name=None, department=None, sort_by=None) -> Employees:
       ...

    name: str
    department: Departments
    salary: float
    hire_date: datetime.date

class Departments:
    name: str
    manager: Employees

def bonus(rec: Employees) -> float:
```

### 2.2 Fonction #2 : `convert_completion` (Python)

**Fichier** : `sandbox/grist/formula_prompt.py:184-260`

**Importance** : Cette fonction est le **traducteur intelligent** qui transforme la réponse libre de l'IA en formule Grist valide et exécutable.

**Ce qu'elle fait** :
1. **Extraction du code** : Extrait le code Python des blocs markdown
2. **Gestion des imports** : Préserve et replace les imports au bon endroit
3. **Extraction du corps** : Si l'IA retourne une fonction complète, extrait seulement le corps
4. **Transformation syntaxique** :
   - Convertit `rec.column_name` → `$column_name` (syntaxe Grist)
   - Supprime les `return` redondants en fin de formule
5. **Validation** : Vérifie que le code est du Python valide

**Exemple de transformation** :
```python
# Entrée (réponse de l'IA)
'''python
def bonus(rec: Employees):
    """Calculate 10% bonus"""
    return rec.salary * 0.1
'''

# Sortie (formule Grist)
$salary * 0.1
```

---

## 3. Format JSON des Données Envoyées à l'API OpenAI

### 3.1 Requête Complète à OpenAI

```json
{
  "model": "gpt-4o-2024-08-06",
  "temperature": 0,
  "user": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6",
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful assistant for a user of software called Grist. Below are one or more fake Python classes representing the structure of the user's data. The function at the end needs completing. The user will probably give a description of what they want the function (a 'formula') to return. If so, your response should include the function BODY as Python code in a markdown block. Your response will be automatically concatenated to the code below, so you mustn't repeat any of it. You cannot change the function signature or define additional functions or classes. It should be a pure function that performs some computation and returns a result. It CANNOT perform any side effects such as adding/removing/modifying rows/columns/cells/tables/etc. It CANNOT interact with files/databases/networks/etc. It CANNOT display images/charts/graphs/maps/etc. If the user asks for these things, tell them that you cannot help. \n\n```python\nclass Departments:\n    def __len__(self):\n        return len(Departments.lookupRecords())\n    @staticmethod\n    def lookupRecords(name=None, manager=None, sort_by=None) -> list[Departments]:\n       ...\n    @staticmethod\n    def lookupOne(name=None, manager=None, sort_by=None) -> Departments:\n       '''\n       Filter for one result matching the keys provided.\n       To control order, use e.g. `sort_by='Key' or `sort_by='-Key'`.\n       '''\n       return Departments.lookupRecords(name=name, manager=manager, sort_by=sort_by)[0]\n\n    name: str\n    manager: Employees\n    budget: float\n\nclass Employees:\n    def __len__(self):\n        return len(Employees.lookupRecords())\n    @staticmethod\n    def lookupRecords(name=None, email=None, department=None, salary=None, hire_date=None, sort_by=None) -> list[Employees]:\n       ...\n    @staticmethod\n    def lookupOne(name=None, email=None, department=None, salary=None, hire_date=None, sort_by=None) -> Employees:\n       '''\n       Filter for one result matching the keys provided.\n       To control order, use e.g. `sort_by='Key' or `sort_by='-Key'`.\n       '''\n       return Employees.lookupRecords(name=name, email=email, department=department, salary=salary, hire_date=hire_date, sort_by=sort_by)[0]\n\n    name: str\n    email: str\n    department: Departments\n    salary: float\n    hire_date: datetime.date\n\ndef bonus(rec: Employees) -> float:\n```"
    },
    {
      "role": "system",
      "content": "Evaluating this code:\n\n```python\n$salary * 0.05\n```\n\nwhere:\n\nrec.salary = 50000\nrec.department = Departments[HR]\n\nreturns: 2500.0"
    },
    {
      "role": "user",
      "content": "I want to give a 10% bonus instead of 5%"
    }
  ]
}
```

### 3.2 Structure de la Requête Initiale depuis le Client

```json
{
  "conversationId": "conv_1234567890_abcdef",
  "text": "I want to give a 10% bonus instead of 5%",
  "context": {
    "tableId": "Employees",
    "colId": "bonus",
    "evaluateCurrentFormula": true,
    "rowId": 1
  },
  "state": {
    "messages": [
      {
        "role": "system",
        "content": "[Schema prompt précédent...]"
      },
      {
        "role": "user",
        "content": "Calculate a 5% bonus based on salary"
      },
      {
        "role": "assistant",
        "content": "```python\n$salary * 0.05\n```"
      }
    ]
  }
}
```

### 3.3 Réponse de l'API OpenAI

```json
{
  "id": "chatcmpl-123456789",
  "object": "chat.completion",
  "created": 1677652288,
  "model": "gpt-4o-2024-08-06",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "To calculate a 10% bonus instead of 5%, simply multiply the salary by 0.1:\n\n```python\n$salary * 0.1\n```\n\nThis will give each employee a bonus equal to 10% of their salary."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 450,
    "completion_tokens": 35,
    "total_tokens": 485
  }
}
```

### 3.4 Réponse Traitée Renvoyée au Client

```json
{
  "suggestedFormula": "$salary * 0.1",
  "suggestedActions": [
    [
      "ModifyColumn",
      "Employees",
      "bonus",
      {
        "formula": "$salary * 0.1"
      }
    ]
  ],
  "reply": "To calculate a 10% bonus instead of 5%, simply multiply the salary by 0.1:\n\n```python\n$salary * 0.1\n```\n\nThis will give each employee a bonus equal to 10% of their salary.",
  "state": {
    "messages": [
      {
        "role": "system",
        "content": "[Schema prompt...]"
      },
      {
        "role": "system",
        "content": "Evaluating this code:\n\n```python\n$salary * 0.05\n```\n\nwhere:\n\nrec.salary = 50000\nrec.department = Departments[HR]\n\nreturns: 2500.0"
      },
      {
        "role": "user",
        "content": "I want to give a 10% bonus instead of 5%"
      },
      {
        "role": "assistant",
        "content": "To calculate a 10% bonus instead of 5%, simply multiply the salary by 0.1:\n\n```python\n$salary * 0.1\n```\n\nThis will give each employee a bonus equal to 10% of their salary."
      }
    ]
  }
}
```

---

## 4. Architecture et Flux de Données

```
┌─────────────────┐
│   Utilisateur   │
│  (Interface UI) │
└────────┬────────┘
         │
         │ 1. Demande d'assistance
         ▼
┌─────────────────────────────────┐
│   FormulaAssistant (Client)     │
│   app/client/widgets/           │
└────────┬────────────────────────┘
         │
         │ 2. POST /api/docs/:docId/assistant
         ▼
┌─────────────────────────────────┐
│      DocApi (Serveur)           │
│   Vérif permissions + limites   │
└────────┬────────────────────────┘
         │
         │ 3. getAssistance()
         ▼
┌─────────────────────────────────┐
│   OpenAIAssistantV1             │
│   Construction des messages     │
└────────┬────────────────────────┘
         │
         │ 4. get_formula_prompt() (Python)
         ▼
┌─────────────────────────────────┐
│   Sandbox Python                │
│   Génération schema prompt      │
└────────┬────────────────────────┘
         │
         │ 5. Schema + User message
         ▼
┌─────────────────────────────────┐
│   OpenAI API                    │
│   https://api.openai.com/v1/    │
│   chat/completions              │
└────────┬────────────────────────┘
         │
         │ 6. Réponse IA (code markdown)
         ▼
┌─────────────────────────────────┐
│   convert_completion() (Python) │
│   Transformation en formule     │
└────────┬────────────────────────┘
         │
         │ 7. Formule + Actions suggérées
         ▼
┌─────────────────────────────────┐
│   Client (UI)                   │
│   Affichage + Bouton "Apply"    │
└─────────────────────────────────┘
```

---

## 5. Configuration et Variables d'Environnement

### Variables Requises
- `OPENAI_API_KEY` ou `ASSISTANT_API_KEY` : Clé API pour OpenAI

### Variables Optionnelles
- `ASSISTANT_CHAT_COMPLETION_ENDPOINT` : URL d'un endpoint custom (défaut: OpenAI)
- `ASSISTANT_MODEL` : Modèle LLM (défaut: `gpt-4o-2024-08-06`)
- `ASSISTANT_LONGER_CONTEXT_MODEL` : Modèle de secours si contexte trop long
- `ASSISTANT_MAX_TOKENS` : Limite de tokens pour les réponses

---

## 6. Considérations de Sécurité et Confidentialité

### ✅ Protections en Place
1. **Permissions** : Vérification `canView` avant accès au schema
2. **Hash utilisateur** : SHA256 au lieu de l'ID réel
3. **Scope limité** : Seulement les tables accessibles
4. **Validation** : Code Python validé avant suggestion
5. **Sandboxing** : Formules exécutées dans un sandbox Python

### ⚠️ Données Exposées
1. **Structure complète** du document (noms tables/colonnes)
2. **Types de données** et relations
3. **Valeurs d'évaluation** (si evaluateCurrentFormula activé)
4. **Historique** de conversation

### 🔒 Recommandations
- Ne pas utiliser l'assistant avec des données ultra-sensibles
- Les noms de colonnes/tables peuvent révéler la nature des données
- Possibilité d'utiliser un endpoint custom auto-hébergé pour un contrôle total
