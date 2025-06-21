# File Management Update Summary

## Changes Made

### 1. Allow Deleting Currently Open File
- Previously showed error when trying to delete the open file
- Now allows deletion and clears the editor
- Sets editor to show "# Select a file to edit"
- Resets status to 'prototype'

### 2. Added Folder Management for Custom Categories
- Right-click support for custom indicator category folders
- Can rename and delete custom category folders
- Default categories (momentum, trend, etc.) are protected
- Only works on custom categories under `/core/indicators/`

## New Features

### Delete Folder
- Only custom indicator categories can be deleted
- Folder must be empty (or only contain __pycache__)
- Shows error if folder contains files
- Default categories cannot be deleted

### Rename Folder
- Only custom indicator categories can be renamed
- Validates folder name (alphanumeric, underscore, dash)
- Prevents duplicate names
- Default categories cannot be renamed

## UI Updates

### Context Menu
- Now works on both files and folders
- Shows "Rename Folder" vs "Rename File" in modal title
- Different validation for folder names (no extension required)

### Validation
- Files: Must include extension (.py, .yaml, .yml)
- Folders: No extension, alphanumeric with underscore/dash only

## Security
- All operations validate paths
- Prevents directory traversal
- Only allows operations within workspace
- Custom categories only under indicators folder

## Usage

1. **Delete current file**: Right-click and delete - editor clears
2. **Delete custom category**: Must be empty, right-click folder
3. **Rename custom category**: Right-click folder, enter new name