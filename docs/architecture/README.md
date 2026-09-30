# Job Search Automations — C4 Architecture

Job Search Automation plugin with dual-mode MCP server, Web UI Dashboard, and automated crawling and scoring pipelines.

## Running Structurizr Local

From the repo root:

```bash
docker pull structurizr/structurizr
docker run -it --rm -p 8080:8080 \
  -v "$(pwd)/job-search-automations/docs/architecture:/usr/local/structurizr" \
  structurizr/structurizr local
```

Or from within `job-search-automations/`:

```bash
docker run -it --rm -p 8080:8080 \
  -v "$(pwd)/docs/architecture:/usr/local/structurizr" \
  structurizr/structurizr local
```

Then open: http://localhost:8080

## Folder Structure

- `workspace.dsl` — Root workspace; wires together all includes
- `models/` — Software system, containers, components, personas, relationships
- `views/` — View definitions (landscape, context, container, component)
- `styles/` — Visual style definitions
