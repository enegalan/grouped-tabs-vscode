const vscode = require('vscode');
const fs = require("fs");
const cheerio = require('cheerio');
const path = require("path");
const os = require("os");

const debug = true;

const tabBgLeftSvg = fs.readFileSync(path.join(__dirname, 'src', 'tab-bg-left.svg'), 'utf8');
const tabBgRightSvg = fs.readFileSync(path.join(__dirname, 'src', 'tab-bg-right.svg'), 'utf8');

const messages = require('./messages.json');

/**
 * Get formatted message.
 * @param {string} key Message key.
 * @param {...string} params Parameters to replace in the message.
 * @returns {string} Formatted message.
 */
function getMessage(key, ...params) {
    let message = messages[key];
    if (!message) return key;
    return message.replace(/{(\d+)}/g, (match, number) => {
        return typeof params[number] !== 'undefined' ? params[number] : match;
    });
}

var groups = {};
var subscriptions = [];
const styleId = 'grouped-tabs-style';
var styleContent = `
/* Tab actions (close button) */
.tab-actions {
    z-index: 5;
}
/* Disable VSCode native tab drag-and-drop indicator */
.monaco-workbench .part.editor>.content .editor-group-container>.title .tabs-container>.tab.drop-target-left:after,
.monaco-workbench .part.editor>.content .editor-group-container>.title .tabs-container>.tab.drop-target-right:before {
    background-color: transparent;
}

/* Tab drag-and-drop */
.tab.drop-target-right:not([aria-selected='true']) .rounded-left-border,
.tab.drop-target-left:not([aria-selected='true']) .rounded-right-border {
    stroke: var(--vscode-tab-dragAndDropBorder)
}

/* Tab rounded borders */
.rounded-left-border, .rounded-right-border {
    position: absolute;
    width: 30px;
    height: 35px;
    overflow: hidden;
    color: var(--vscode-tab-inactiveBackground);
}

.rounded-right-border { right: -15px; }

.rounded-left-border { left: -15px; }

/* Set active color */
.tab.active .rounded-left-border,
.tab.active .rounded-right-border {
    color: var(--vscode-tab-activeBackground);
}

.rounded-right-border svg,
.rounded-left-border svg {
    width: inherit;
    height: inherit;
    stroke-width: 2;
}

/* Tab space-between */
.tab {
    margin-left: 14px;
    margin-right: 14px;
}

/* 
    Tab hover effect
    - Change the color of the rounded borders to the tab background color
    - Via JS we set the --tab-border-hover-color variable to the tab background color (Necessary to work with all VSCode Themes)
*/
.monaco-workbench .part.editor > .content .editor-group-container.active > .title .tabs-container > .tab:not(.selected):hover .rounded-left-border,
.monaco-workbench .part.editor > .content .editor-group-container.active > .title .tabs-container > .tab:not(.selected):hover .rounded-right-border {
    color: var(--tab-border-hover-color) !important;
}
`;
const scriptId = 'grouped-tabs-script';
var scriptContent = `
    const updateTabsBackground = () => {
        const tabs = document.querySelectorAll('.tab');
        tabs.forEach(tab => {
            let tabColor = getComputedStyle(tab).backgroundColor;
            if (!tab.querySelector('.rounded-left-border')) {
                createRoundedBorderDiv(tab, 'rounded-left-border', \`${tabBgLeftSvg}\`);
            }
            if (!tab.querySelector('.rounded-right-border')) {
                createRoundedBorderDiv(tab, 'rounded-right-border', \`${tabBgRightSvg}\`);
            }
        });
    };

    const createRoundedBorderDiv = (tab, className, svgContent) => {
        let roundedBorderDiv = document.createElement('div');
        roundedBorderDiv.className = className;
        roundedBorderDiv.innerHTML = svgContent;
        tab.appendChild(roundedBorderDiv);
        tab.addEventListener('mouseover', () => {
            const backgroundColor = getComputedStyle(tab).backgroundColor;
            roundedBorderDiv.style.setProperty('--tab-border-hover-color', backgroundColor);
        });
    };

    const getTabByAriaLabel = (ariaLabel) => {
        let tab = document.querySelector('.tabs-container [aria-label~="' + ariaLabel + '"]')?.parentElement;
        if (!tab) {
            // Try to get tab with filename only
            ariaLabel = ariaLabel.split('/').pop();
            tab = document.querySelector('.tabs-container [aria-label~="' + ariaLabel + '"]') || null;
        }
        return tab;
    };

    const onTabsLoad = (callback) => {
        if (typeof callback !== 'function') return;
        const tabsObserver = new MutationObserver((mutationsList, observer) => {
            mutationsList.forEach(mutation => {
                if (mutation.addedNodes.length > 0) {
                    setTimeout(callback, 5000);
                    observer.disconnect();
                }
            });
        });
        tabsObserver.observe(document.body, { childList: true, subtree: true });
    };

    const onTabsContainerChanges = (callback) => {
        const newTabObserver = new MutationObserver(() => {
            callback();
        });
        let observe = () => newTabObserver.observe(document.querySelector('.tabs-container'), { childList: true });
        onTabsLoad(observe);
    };

    // Create an observer to detect when the tabs are loaded
    onTabsLoad(updateTabsBackground);

    // Initial call to update existing tabs
    updateTabsBackground();

    // Observe for new tabs being added
    onTabsContainerChanges(updateTabsBackground);
`;
var script = null;
var htmlPath = null;
const backupFileName = 'workbench.html.backup';

/**
 * Activate extension.
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    // Load saved groups from global state
    const savedGroups = context.globalState.get('groups', groups);
    if (savedGroups) groups = savedGroups;
    writeOnVsCode(scriptContent, styleContent);
    // * Right-click context menu command for files in explorer
    const fileContextMenuCommand = vscode.commands.registerCommand('extension.addFileToGroupFromExplorer', async (uri) => {
        if (!uri) return;
        const fileName = uri.fsPath.split('/').pop();
        const existingGroup = findGroupForFile(fileName);
        if (existingGroup) {
            openFile(uri.fsPath);
        } else {
            tabRightClickProcedure(fileName, uri, context);
        }
    });
    subscriptions.push(fileContextMenuCommand);

    // * Tab right-click context menu command
    const tabContextMenuCommand = vscode.commands.registerCommand('extension.addFileToNewGroupFromTab', async (uri) => {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) return;
        if (typeof uri === 'undefined') return;
        const fileName = uri.fsPath.split('/').pop();
        tabRightClickProcedure(fileName, uri, context);
    });
    subscriptions.push(tabContextMenuCommand);

    // Hack to set different titles to menu context labels (for the same command)
    vscode.commands.registerCommand('extension.addFileToGroupFromTab', async (uri) => {
        vscode.commands.executeCommand('extension.addFileToNewGroupFromTab', uri);
    });

    // Add context menu for adding tab to another group
    vscode.commands.registerCommand('extension.addTabToGroup', async (uri) => {
        vscode.commands.executeCommand('extension.addFileToNewGroupFromTab', uri);
    });

    // * Tab Submenu commands
    // Command to create a group from tab submenu
    const createGroupCommand = vscode.commands.registerCommand('extension.createGroup', async () => {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            const uri = activeEditor.document.uri;
            const fileName = uri.fsPath.split('/').pop();
            createGroupProcedure(fileName, uri.fsPath, context);
        }
    });
    subscriptions.push(createGroupCommand);

    // Command to delete a group from tab submenu
    const deleteGroupCommand = vscode.commands.registerCommand('extension.deleteGroup', async (uri) => {
        // Get groups that contains the file
        const deletableGroups = getDeletableGroupNames(uri.fsPath);
        if (debug) console.log('Deleting group', uri, groups, deletableGroups);
        const selectedGroup = await vscode.window.showQuickPick(deletableGroups, {
            placeHolder: 'Select a group to delete',
        });
        if (selectedGroup) removeGroup(selectedGroup, context);
    });
    subscriptions.push(deleteGroupCommand);

    // Command to restore VSCode backup
    const restoreBackupCommand = vscode.commands.registerCommand('extension.restoreBackup', async () => {
        try {
            const backupPath = path.join(path.dirname(htmlPath), backupFileName);
            if (fs.existsSync(backupPath)) {
                fs.copyFileSync(backupPath, htmlPath);
                vscode.window.showInformationMessage('Backup restored successfully. Please reload VSCode.');
                vscode.commands.executeCommand('workbench.action.reloadWindow');
            } else {
                vscode.window.showWarningMessage('No backup found to restore.');
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Error restoring backup: ${error.message}`);
        }
    });
    subscriptions.push(restoreBackupCommand);

    // Visible editors changes listener
    vscode.window.onDidChangeVisibleTextEditors(() => {
        updateContext(context);
    });
    // Active editor changes listener
    vscode.window.onDidChangeActiveTextEditor(() => {
        updateContext(context);
    });
    // Editor closes listener
    vscode.workspace.onDidCloseTextDocument(() => {
        updateContext(context);
    });
    // Window state changes listener
    vscode.window.onDidChangeWindowState(() => {
        updateContext(context);
    });
    updateContext(context);
    // Add subscriptions / commands
    subscriptions.forEach(subscription => context.subscriptions.push(subscription));
    // Save groups to global state on deactivate
    context.subscriptions.push({
        dispose: () => {
            context.globalState.update('groups', groups);
        }
    });
    // Paint tabs grouping on startup
    paintTabsGrouping(false);
}

/**
 * Get environment variable.
 */
function env(key) {
    const variables = {
        userHome: () => os.homedir(),
        execPath: () => process.env.VSCODE_EXEC_PATH ?? process.execPath,
    };
    if (key in variables) return variables[key]();
    return process.env[key];
}

/**
 * Procedure for tab right-click context menu.
 */
async function tabRightClickProcedure(fileName, uri, context) {
    const groupNames = Object.keys(groups);
    if (groupNames.length > 0) {
        const selectedGroup = await vscode.window.showQuickPick([...groupNames, 'Create New Group'], {
            placeHolder: 'Select a group or create a new one',
        });
        if (selectedGroup === 'Create New Group') {
            createGroupProcedure(fileName, uri.fsPath, context);
        } else if (selectedGroup) {
            addToGroup(selectedGroup, fileName, uri.fsPath, context);
        }
    } else {
        createGroupProcedure(fileName, uri.fsPath, context);
    }
    updateContext(context);
}

/**
 * Procedure for creating groups.
 */
async function createGroupProcedure(fileName, path, context) {
    const groupName = await vscode.window.showInputBox({ prompt: 'Enter new group name' });
    if (groupName) {
        createGroup(groupName, context);
        addToGroup(groupName, fileName, path, context);
    }
}

/**
 * Updates the context of the extension.
 */
function updateContext(context) {
    const groupNames = Object.keys(groups);
    vscode.commands.executeCommand('setContext', 'hasGroups', groupNames.length > 0);
    // Get grouped files names
    const groupedFiles = getGroupedFilePaths();
    vscode.commands.executeCommand('setContext', 'grouped.files.names', groupedFiles);
}

/**
 * Open file on editor.
 * @param {string} path File path.
 */
async function openFile(path) {
    if (debug) console.log('Opening file:', path);
    const uri = vscode.Uri.file(path);
    vscode.workspace.openTextDocument(uri).then(async doc => {
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
    });
}

/**
 * Get deletable group names.
 * @param {string} uriPath File path.
 * @returns {string[]} Group names.
 */
function getDeletableGroupNames(uriPath) {
    return Object.entries(groups)
        .filter(([groupName, group]) => group.files.some(file => file.path === uriPath))
        .map(([groupName, group]) => groupName);
}

/**
 * Get grouped filenames.
 * @returns {string[]} Group names.
 */
function getGroupedFilePaths() {
    return Object.values(groups)
        .flatMap(group => group.files.map(file => file.path));
}

/**
 * Close file on editor.
 * @param {string} path File path.
 */
async function closeFile(path) {
    if (debug) console.log('Closing file:', path);
    const openFiles = getOpenFiles(false);
    const targetFile = openFiles.find(file => file.input.uri.fsPath === path);
    try {
        await vscode.window.tabGroups.close(targetFile);
    } catch (error) {
        vscode.window.showErrorMessage(`Error closing file ${path}: ${error.message}`);
    }
}

/**
 * Finds file if exists on any group.
 * @param {string} fileName File name.
 * @returns {string|null} Group name if exists, or null if not.
 */
function findGroupForFile(fileName) {
    for (const [groupName, group] of Object.entries(groups)) {
        for (const file of group.files) {
            if (file.name === fileName) {
                return groupName;
            }
        }
    }
    return null;
}

/**
 * Create a group with a name and a random color.
 * @param {string} name Group name.
 */
function createGroup(name, context) {
    if (debug) console.log('Creating group:', name);
    const color = getRandomColor();
    groups[name] = { color, files: [] };
    vscode.window.showInformationMessage(getMessage('groupCreated', name));
    updateContext(context);
    context.globalState.update('groups', groups);
}

/**
 * Removes a group.
 * @param {string} groupName Group name.
 */
function removeGroup(groupName, context) {
    if (debug) console.log('Removing group:', groupName);
    if (groups[groupName]) {
        delete groups[groupName];
        vscode.window.showInformationMessage(getMessage('groupRemoved', groupName));
        updateContext(context);
        context.globalState.update('groups', groups);
    } else {
        vscode.window.showErrorMessage(getMessage('groupDoesNotExist', groupName));
    }
}

/**
 * Show all tabs of a group.
 * @param {string} groupName Group name.
 */
async function showGroupTabs(groupName) {
    if (debug) console.log('Showing tabs for group:', groupName);
    if (groups[groupName]) {
        for (const file of groups[groupName].files) {
            await openFile(file.path); // Ensure file is opened until continue
        }
        vscode.window.showInformationMessage(`Group ${groupName} tabs displayed successfully.`);
    } else {
        vscode.window.showErrorMessage(`Group ${groupName} does not exist.`);
    }
}

/**
 * Hide all tabs of a group.
 * @param {string} groupName Group name.
 */
async function hideGroupTabs(groupName) {
    if (debug) console.log('Hiding tabs for group:', groupName);
    if (groups[groupName]) {
        for (const file of groups[groupName].files) {
            await closeFile(file.path); // Ensure file is closed until continue
        }
        vscode.window.showInformationMessage(`Group ${groupName} tabs hidden successfully.`);
    } else {
        vscode.window.showErrorMessage(`Group ${groupName} does not exist.`);
    }
}

/**
 * Add file to a group.
 * @param {string} groupName Group name.
 * @param {string} fileName File name.
 * @param {string} path File absolute path.
 */
function addToGroup(groupName, fileName, path, context) {
    if (debug) console.log('Adding file to group:', groupName, fileName, path);
    if (groups[groupName]) {
        const fileAlreadyExists = groups[groupName].files.some(file => file.path === path);
        if (!fileAlreadyExists) {
            // Remove file from previous group
            const existingGroup = findGroupForFile(fileName);
            if (existingGroup) removeFromGroup(existingGroup, fileName);
            groups[groupName].files.push({
                name: fileName,
                path: path,
            });
            // Perform a CTRL + S to save the file and prevent from not painting the tab
            vscode.commands.executeCommand('workbench.action.files.save');
            context.globalState.update('groups', groups);
            paintTabsGrouping(true);
            vscode.window.showInformationMessage(getMessage('fileAddedToGroup', groupName));
        } else {
            vscode.window.showWarningMessage(getMessage('fileAlreadyInGroup'));
        }
    } else {
        vscode.window.showErrorMessage(getMessage('groupDoesNotExist', groupName));
    }
}
/**
 * Parse URI path for finding VSCode DOM tab given a a path.
 * @param {string} path Absolute path that is pretended to find a DOM tab with aria-label attribute.
 */
function parseTabAriaLabel(path) {
    const userHome = env('userHome');
    // TODO: Investigate on differents OS if '~/' works, if not a condition is needed here
    return path.replace(userHome + '/', '~/');
}

function paintTabsGrouping(hotReload = false) {
    var scriptToInject = scriptContent;
    const openFiles = getOpenFiles(false);
    openFiles.forEach((file, index) => {
        let arialabel = parseTabAriaLabel(file.input.uri.fsPath);
        const groupName = findGroupForFile(file.input.uri.fsPath.split('/').pop());
        if (groupName) {
            console.log(`[paintTabsGrouping] Painting tab ${index}:`, arialabel, groupName);
            scriptToInject += `
                function paintTabsGroupingFor${index}() {
                    console.log('[paintTabsGrouping${index}] Trying to get tab with aria-label:', "${arialabel}");
                    var tab = getTabByAriaLabel("${arialabel}");
                    console.log('[paintTabsGrouping${index}] Tab found:', tab);
                    if (${debug}) console.log('[paintTabsGrouping${index}] Trying to get tab with aria-label:', "${arialabel}", tab);
                    if (tab) {
                        tab.classList.add('grouped-tab');
                        var groupDiv = document.getElementById('group-${groupName}');
                        if (!groupDiv) {
                            groupDiv = document.createElement('div');
                            groupDiv.id = 'group-${groupName}';
                            groupDiv.className = 'tabs-group';
                            tab.parentNode.insertBefore(groupDiv, tab);
                        }
                        groupDiv.appendChild(tab);
                    }
                }
                onTabsLoad(paintTabsGroupingFor${index});
            `;
        }
    });
    writeOnVsCode(scriptToInject, styleContent, hotReload);
}

/**
 * Removes file from a group
 * @param {string} groupName Group name.
 * @param {string} fileName File name.
 */
function removeFromGroup(groupName, fileName) {
    if (debug) console.log('Removing file from group:', groupName, fileName);
    if (groups[groupName]) {
        const fileIndex = groups[groupName].files.findIndex(file => file.name === fileName);
        if (fileIndex !== -1) {
            groups[groupName].files.splice(fileIndex, 1);
            // Check if the group is empty and remove it
            if (groups[groupName].files.length === 0) {
                if (debug) console.log('Group is empty, removing it:', groupName);
                delete groups[groupName];
            }
            vscode.window.showInformationMessage(getMessage('fileRemovedFromGroup', fileName, groupName));
            context.globalState.update('groups', groups);
        } else {
            vscode.window.showWarningMessage(getMessage('fileNotInGroup', fileName, groupName));
        }
    } else {
        vscode.window.showErrorMessage(getMessage('groupDoesNotExist', groupName));
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
 * Get editor open files
 * @returns {vscode.Tab[]} Tabs array.
 */
function getOpenFiles(exclude_grouped = true) {
    if (debug) console.log('Getting open files, exclude_grouped:', exclude_grouped, vscode.window.tabGroups.all);
    const allOpenFiles = vscode.window.tabGroups.all
        .flatMap(group => group.tabs)
        .filter(tab => tab.input && tab.input.uri); // Exclude tabs without file
    const groupedFiles = Object.values(groups).flatMap(group => group.files.map(file => file.path));
    var openFiles = allOpenFiles;
    if (exclude_grouped) {
        openFiles = allOpenFiles.filter(file => !groupedFiles.includes(file.input.uri.fsPath)); // Exclude those that are already grouped
    }
    return openFiles;
}

/**
 * Check if files is already opened
 * @param {string} path Absolute file path.
 * @returns {boolean} Returns true when file is already opened.
 */
function isFileOpened(path) {
    if (debug) console.log('Checking if file is opened:', path);
    return getOpenFiles(false).some(openFile => openFile.input.uri.fsPath === path);
}

/**
 * Write on VSCode file to insert custom CSS and JS.
 * @param {string} scriptContentToInject Script content.
 * @param {string} styleContentToInject Style content.
 * @returns {void}
 */
function writeOnVsCode(scriptContentToInject, styleContentToInject, hotReload = false) {
    const appDir = require.main
		? path.dirname(require.main.filename)
		: globalThis._VSCODE_FILE_ROOT;
	const base = path.join(appDir, "vs", "code");
	htmlPath = path.join(base, "electron-sandbox", "workbench", "workbench.html");
	if (!fs.existsSync(htmlPath)) {
		htmlPath = path.join(base, "electron-sandbox", "workbench", "workbench.esm.html");
	}
	if (!fs.existsSync(htmlPath)) {
		vscode.window.showInformationMessage(getMessage('vscodePathNotFound'));
	}
    const backupPath = path.join(path.dirname(htmlPath), backupFileName);
    if (!fs.existsSync(backupPath)) {
        fs.copyFileSync(htmlPath, backupPath);
        if (debug) console.log(getMessage('backupCreated'));
    }
    fs.readFile(htmlPath, 'utf8', (err, data) => {
        if (err) {
            console.error('Error while reading VSCode layout', err);
            return;
        }
        const $ = cheerio.load(data);
        $('meta[http-equiv="Content-Security-Policy"]').remove();
        script = $('#'+scriptId);
        // Clean old script
        let scriptExists = script.length;
        if (scriptExists) script.remove();
        // Load script
        let scriptToInject = `
            // Clear old style
            if (document.getElementById('${styleId}')) {
                document.getElementById('${styleId}').remove();
            }
            // Load style
            const styleElement = document.createElement('style');
            styleElement.id = '${styleId}';
            styleElement.textContent = \`${styleContentToInject}\`;
            document.head.append(styleElement);
        ` + scriptContentToInject;
        $('html').append('<script id="' + scriptId + '">'+scriptToInject+'</script>');
        // Set new layout
        fs.writeFile(htmlPath, $.html(), (err) => {
            if (err) {
                if (debug) console.error('Error saving VSCode file', err);
            } else {
                if (debug) console.log('VSCode File Correctly Saved')
            }
        });
        // Reload VSCode
        if (hotReload) vscode.commands.executeCommand('workbench.action.reloadWindow');
    })
}

/**
 * Deactivate extension.
 */
function deactivate() {}

module.exports = {
	activate,
	deactivate
}
