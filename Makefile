build:
	./tools/build_deploy.sh
	python3 tools/build_selfcontained_deploy.py
	cd build && shasum -a 256 deploy/application.zip deploy_selfcontained.js > SHA256SUMS.txt

serve:
	python3 tools/serve.py

test:
	node tools/test_predict.mjs

.PHONY: build serve test
