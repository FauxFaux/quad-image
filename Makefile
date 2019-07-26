all: web/bundle.js

%.js: node_modules tsconfig.json web/index.tsx
	npm run build

node_modules: package.json
	npm install
	touch node_modules
