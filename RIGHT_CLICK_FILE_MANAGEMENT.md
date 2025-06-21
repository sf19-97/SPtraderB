# Right-Click File Management Implementation

## Features Added

### 1. Right-Click Context Menu
- Right-click any file in the file tree to open a context menu
- Two options: Rename and Delete
- Only available for files, not folders
- Menu appears at cursor position

### 2. Delete Functionality
- Shows confirmation dialog: "Are you sure you want to delete {filename}?"
- Prevents deleting currently open file
- Shows success/error message in terminal
- Automatically refreshes file tree after deletion

### 3. Rename Functionality
- Opens modal with current filename
- Validates new filename (must include extension)
- Prevents invalid characters in filename
- Updates selected file path if renaming current file
- Shows success/error message in terminal
- Automatically refreshes file tree after rename

## Implementation Details

### Rust Backend Commands
- `delete_component_file(file_path)`: Safely deletes a file with validation
- `rename_component_file(old_path, new_name)`: Renames file with collision detection

### Security Features
- Path traversal prevention (no ".." allowed)
- Files must be within workspace directory
- New filenames can't contain path separators
- Validates file existence before operations

### UI Components
- Mantine Menu for context menu
- Mantine Modal for rename dialog
- Uses existing icon theme (IconEdit, IconTrash)
- Follows existing UI patterns and styling

## Usage

1. **Delete a file**:
   - Right-click on any file in the tree
   - Select "Delete" (red text)
   - Confirm the deletion

2. **Rename a file**:
   - Right-click on any file in the tree
   - Select "Rename"
   - Enter new name (with extension)
   - Press Enter or click Rename

## Edge Cases Handled

- Cannot delete currently open file
- Cannot rename to existing filename
- Invalid filename characters rejected
- File tree automatically refreshes
- Terminal shows all operations
- Selected file path updates on rename

## Testing

1. Right-click on any Python or YAML file
2. Try renaming with valid/invalid names
3. Try deleting a file (not the current one)
4. Try deleting the currently open file (should fail)
5. Check that file tree updates automatically