#!/bin/bash

# Simple script to update chart library and deploy to Vercel

echo "Updating sptrader-chart-lib..."
npm update sptrader-chart-lib

echo "Committing changes..."
git add package.json package-lock.json
git commit -m "chore: update sptrader-chart-lib to latest version"

echo "Pushing to Vercel..."
git push origin main

echo "✅ Done! Vercel will automatically deploy with the updated package."