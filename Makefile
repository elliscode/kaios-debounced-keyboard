build:
	./tools/build_deploy.sh
	python3 tools/build_selfcontained_deploy.py

serve:
	python3 tools/serve.py

.PHONY: build serve
