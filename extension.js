const vscode = require('vscode');

var groups = {};
var activePanel;
const commandId = 'extension.openGroupManager';
const panelId = 'tabGroupManager';
const panelTitle = 'Tabs Groups Manager';
/**
 * Activate extension.
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    // Create a status bar item (button)
    const statusBarButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarButton.text = '$(layers) Open Tabs Groups Manager';
    statusBarButton.command = commandId;
    statusBarButton.show();
    context.subscriptions.push(statusBarButton);
    // Create command
    const viewColumn = vscode.ViewColumn.Beside;
    const openGroupManagerCommand = vscode.commands.registerCommand(commandId, () => {
        activePanel = vscode.window.createWebviewPanel(
            panelId,
            panelTitle,
            viewColumn,
            { enableScripts: true }
        );
        activePanel.webview.html = getWebviewContent();
        activePanel.webview.onDidReceiveMessage(async (message) => {
            console.debug('Message received from webview:', message);
            switch (message.command) {
                case 'createGroup': {
                    vscode.window.showInputBox({ prompt: 'Enter new group name' })
                    .then(groupName => {
                        if (groupName) {
                            createGroup(groupName);
                            updateWebviewContent();
                        }
                    });
                    break;
                }
                case 'removeGroup': {
                    const { group } = message;
                    if (group) {
                        console.debug('Removing group:', group);
                        removeGroup(group);
                        updateWebviewContent();
                    } else {
                        vscode.window.showErrorMessage('Error: group not specified.');
                    }
                    break;
                }
                case 'addFileToGroup': {
                    const { group, file } = message;
                    if (group && file) {
                        console.debug('Adding file ' + file + ' to group ' + group)
                        addToGroup(group, file);
                        updateWebviewContent();
                    } else {
                        vscode.window.showErrorMessage('Error: group or file not specified.')
                    }
                    break;
                }
                case 'removeFileFromGroup': {
                    const { group, file } = message;
                    if (group && file) {
                        console.debug('Removing file ' + file + ' from group ' + group);
                        removeFromGroup(group, file);
                        updateWebviewContent();
                    } else {
                        vscode.window.showErrorMessage('Error: group or file not specified.');
                    }
                    break;
                }
                default:
                    vscode.window.showErrorMessage('Unknown command.');
                    break;
            }
        });
    });
    // Add command
    context.subscriptions.push(openGroupManagerCommand);

    // Visible editors changes listener
    vscode.window.onDidChangeVisibleTextEditors(() => {
        updateWebviewContent();
    });
    // Active editor changes listener
    vscode.window.onDidChangeActiveTextEditor(() => {
        updateWebviewContent();
    });
    // Editor closes listener
    vscode.workspace.onDidCloseTextDocument(() => {
        updateWebviewContent();
    });
    // Window state changes listener
    vscode.window.onDidChangeWindowState(() => {
        updateWebviewContent();
    })
}

/**
 * Create a group with a name and a random color.
 * @param {string} name Group name.
 */
function createGroup(name) {
    const color = getRandomColor();
    groups[name] = { color, files: [] };
    vscode.window.showInformationMessage(`Group ${name} created successfully.`);
}

/**
 * Removes a group.
 * @param {string} groupName Group name.
 */
function removeGroup(groupName) {
    if (groups[groupName]) {
        delete groups[groupName];
        vscode.window.showInformationMessage(`Group ${groupName} removed successfully.`);
    } else {
        vscode.window.showErrorMessage(`Group ${groupName} does not exist.`);
    }
}

/**
 * Add file to a group.
 * @param {string} groupName Group name.
 * @param {string} fileName File name.
 */
function addToGroup(groupName, fileName) {
    if (groups[groupName]) {
        if (!groups[groupName].files.includes(fileName)) {
            groups[groupName].files.push(fileName);
            vscode.window.showInformationMessage(`File added to group ${groupName}.`);
        } else {
            vscode.window.showWarningMessage(`File is already in this group.`);
        }
    } else {
        vscode.window.showErrorMessage(`Group ${groupName} does not exists.`);
    }
}

/**
 * Removes file from a group
 * @param {string} groupName Group name.
 * @param {string} fileName File name.
 */
function removeFromGroup(groupName, fileName) {
    if (groups[groupName]) {
        const fileIndex = groups[groupName].files.indexOf(fileName);
        if (fileIndex > -1) {
            groups[groupName].files.splice(fileIndex, 1);
            vscode.window.showInformationMessage(`File ${fileName} removed from group '${groupName}'.`);
        } else {
            vscode.window.showWarningMessage(`File ${fileName} is not in group '${groupName}'.`);
        }
    } else {
        vscode.window.showErrorMessage(`Group ${groupName} does not exist.`);
    }
}

/**
 * Generate random color with hexadecimal format.
 * @returns {string} Random color with format `#RRGGBB`.
 */
function getRandomColor() {
    const randomColor = Math.floor(Math.random() * 0xffffff).toString(16);
    return `#${randomColor.padStart(6, '0')}`;
}

/**
 * Generate Webview HTML content.
 * @returns {string} HTML string.
 */
function getWebviewContent() {
	console.debug('Generating Webview Content.');
    const allOpenFiles = vscode.window.tabGroups.all
        .flatMap(group => group.tabs)
        .filter(tab => tab.input && tab.input.uri) // Exclude tabs without file
        .filter(tab => tab.label !== panelTitle) // Exclude the tabs groups manager itself
        .map(tab => tab.label);
    const groupedFiles = Object.values(groups).flatMap(group => group.files);
    const openFiles = allOpenFiles.filter(file => !groupedFiles.includes(file)); // Exclude those that are already grouped
    const groupsHtml = Object.entries(groups)
        .map(([groupName, group]) => {
            const filesHtml = group.files
                .map(file => `
                    <li>
                        ${file} 
                        <button onclick="removeFile('${groupName}', '${file}')">Remove</button>
                    </li>
                `)
                .join('');
            return `
                <div class="group" style="border: 2px solid ${group.color}; margin: 10px; padding: 10px;"
                    ondrop="drop(event, '${groupName}')" ondragover="allowDrop(event)">
                    <h3 style="color: #e8e8e8;">${groupName} (${group.files.length})</h3>
                    <ul>${filesHtml}</ul>
                    <button onclick="removeGroup('${groupName}')">Delete Group</button>
                </div>`;
        })
        .join('');
    // Create open files list
    var filesHtml = '';
    if (openFiles.length > 0) {
        filesHtml = openFiles.map(file => `
            <div class="file" draggable="true" ondragstart="drag(event, '${file}')">${file}</div>
        `).join('');
    }
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${panelTitle}</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    padding: 10px;
                }
                .file {
                    padding: 10px;
                    margin: 5px 0;
                    background-color: #007acc;
                    color: white;
                    border: none;
                    border-radius: 5px;
                    cursor: grab;
                    text-align: center;
                }
                .file:hover {
                    background-color: #005f99;
                }
                .group {
                    padding: 10px;
                    border-radius: 5px;
                    background-color: #1e1e1e;
                }
                .group ul {
                    padding-left: 20px;
                }
                .group ul li {
                    list-style-type: disc;
                    color: white;
                }
                #open-files section {
                    display: flex;
                    gap: 0.65rem;
                    justify-content: left;
                    vertical-align: center;
                }
            </style>
        </head>
        <body>
            <h1>${panelTitle}</h1>
            <div id="groups">
                <h2>Groups</h2>
                <button onclick="vscode.postMessage({ command: 'createGroup' })">Create Group</button>
                ${groupsHtml}
            </div>
            <div id="open-files">
                ${filesHtml !== '' ? '<h2>Open tabs</h2>' : ''}
                <section>
                    ${filesHtml}
                </section>
            </div>
            <script>
                const vscode = acquireVsCodeApi();
                function allowDrop(event) { event.preventDefault(); }
                function drag(event, fileName) { event.dataTransfer.setData("text/plain", fileName); }
                function drop(event, groupName) {
                    event.preventDefault();
                    const fileName = event.dataTransfer.getData("text/plain");
                    vscode.postMessage({
                        command: 'addFileToGroup',
                        group: groupName,
                        file: fileName
                    });
                }
                function removeFile(groupName, fileName) {
                    vscode.postMessage({ command: 'removeFileFromGroup', group: groupName, file: fileName });
                }
                function removeGroup(groupName) {
                    vscode.postMessage({ command: 'removeGroup', group: groupName });
                }
            </script>
        </body>
        </html>
    `;
}

/**
 * Update Webview Content UI.
 */
function updateWebviewContent() {
    if (activePanel) {
        activePanel.webview.html = getWebviewContent();
    }
}

/**
 * Deactivate extension.
 */
function deactivate() {}

module.exports = {
	activate,
	deactivate
}
