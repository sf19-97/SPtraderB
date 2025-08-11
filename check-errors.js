#!/usr/bin/env node

import { execSync } from 'child_process';
import { readFileSync } from 'fs';

const colors = {
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

function runCommand(cmd, cwd = '.') {
  try {
    return execSync(cmd, { encoding: 'utf-8', cwd, stdio: 'pipe' });
  } catch (e) {
    return e.stdout || e.stderr || '';
  }
}

function summarizeTypeScriptErrors() {
  console.log(`\n${colors.blue}${colors.bold}TypeScript Errors:${colors.reset}`);
  
  const output = runCommand('npx tsc --noEmit --pretty false');
  const lines = output.split('\n').filter(line => line.trim());
  
  const errors = {};
  const warnings = {};
  
  lines.forEach(line => {
    // Parse TypeScript errors: "src/file.ts(10,5): error TS2322: ..."
    const match = line.match(/^(.+?)\((\d+),(\d+)\): (error|warning) (TS\d+): (.+)$/);
    if (match) {
      const [, file, line, col, severity, code, message] = match;
      const category = categorizeTypeScriptError(code, message);
      
      if (severity === 'error') {
        errors[category] = errors[category] || [];
        errors[category].push({ file, line, message: message.substring(0, 80) + '...' });
      } else {
        warnings[category] = warnings[category] || [];
        warnings[category].push({ file, line, message: message.substring(0, 80) + '...' });
      }
    }
  });
  
  let errorCount = 0;
  let warningCount = 0;
  
  Object.entries(errors).forEach(([category, items]) => {
    console.log(`  ${colors.red}${category}: ${items.length} errors${colors.reset}`);
    errorCount += items.length;
    if (items.length <= 3) {
      items.forEach(item => {
        console.log(`    - ${item.file}:${item.line} - ${item.message}`);
      });
    }
  });
  
  Object.entries(warnings).forEach(([category, items]) => {
    console.log(`  ${colors.yellow}${category}: ${items.length} warnings${colors.reset}`);
    warningCount += items.length;
  });
  
  console.log(`  ${colors.bold}Total: ${errorCount} errors, ${warningCount} warnings${colors.reset}`);
  
  return { errors: errorCount, warnings: warningCount };
}

function summarizeESLintErrors() {
  console.log(`\n${colors.blue}${colors.bold}ESLint Issues:${colors.reset}`);
  
  const output = runCommand('npx eslint src --ext .ts,.tsx --format json');
  
  try {
    const results = JSON.parse(output);
    const summary = {};
    let errorCount = 0;
    let warningCount = 0;
    
    results.forEach(file => {
      file.messages.forEach(msg => {
        const category = categorizeESLintError(msg.ruleId);
        summary[category] = summary[category] || { errors: 0, warnings: 0, files: new Set() };
        
        if (msg.severity === 2) {
          summary[category].errors++;
          errorCount++;
        } else {
          summary[category].warnings++;
          warningCount++;
        }
        
        summary[category].files.add(file.filePath.replace(process.cwd() + '/', ''));
      });
    });
    
    Object.entries(summary).forEach(([category, data]) => {
      const fileCount = data.files.size;
      console.log(`  ${colors.yellow}${category}:${colors.reset}`);
      console.log(`    - ${data.errors} errors, ${data.warnings} warnings in ${fileCount} files`);
      if (fileCount <= 3) {
        console.log(`    - Files: ${[...data.files].join(', ')}`);
      }
    });
    
    console.log(`  ${colors.bold}Total: ${errorCount} errors, ${warningCount} warnings${colors.reset}`);
    
    return { errors: errorCount, warnings: warningCount };
  } catch (e) {
    console.log('  No ESLint issues found or ESLint not configured');
    return { errors: 0, warnings: 0 };
  }
}

function summarizeRustErrors() {
  console.log(`\n${colors.blue}${colors.bold}Rust Warnings:${colors.reset}`);
  
  const output = runCommand('cargo check --message-format=short', 'src-tauri');
  const lines = output.split('\n').filter(line => line.includes('warning:') || line.includes('error:'));
  
  const issues = {};
  
  lines.forEach(line => {
    // Parse Rust warnings: "src/main.rs:10:5: warning: unused variable: `x`"
    const match = line.match(/^(.+?):(\d+):(\d+): (warning|error): (.+)$/);
    if (match) {
      const [, file, line, col, severity, message] = match;
      const category = categorizeRustWarning(message);
      
      issues[category] = issues[category] || [];
      issues[category].push({
        file: file.replace('src/', ''),
        line,
        severity,
        message: message.substring(0, 60) + '...'
      });
    }
  });
  
  let errorCount = 0;
  let warningCount = 0;
  
  Object.entries(issues).forEach(([category, items]) => {
    const errors = items.filter(i => i.severity === 'error').length;
    const warnings = items.filter(i => i.severity === 'warning').length;
    
    errorCount += errors;
    warningCount += warnings;
    
    const color = errors > 0 ? colors.red : colors.yellow;
    console.log(`  ${color}${category}: ${errors} errors, ${warnings} warnings${colors.reset}`);
    
    if (items.length <= 3) {
      items.forEach(item => {
        console.log(`    - ${item.file}:${item.line} - ${item.message}`);
      });
    }
  });
  
  console.log(`  ${colors.bold}Total: ${errorCount} errors, ${warningCount} warnings${colors.reset}`);
  
  return { errors: errorCount, warnings: warningCount };
}

function categorizeTypeScriptError(code, message) {
  if (message.includes('any')) return 'Type Any Issues';
  if (message.includes('unused') || message.includes('never used')) return 'Unused Code';
  if (message.includes('undefined') || message.includes('null')) return 'Null/Undefined Issues';
  if (message.includes('import')) return 'Import Issues';
  if (message.includes('type') || code.startsWith('TS23')) return 'Type Errors';
  return 'Other Issues';
}

function categorizeESLintError(ruleId) {
  if (!ruleId) return 'Other';
  if (ruleId.includes('unused')) return 'Unused Variables';
  if (ruleId.includes('no-explicit-any')) return 'TypeScript Any';
  if (ruleId.includes('import')) return 'Import Issues';
  if (ruleId.includes('react')) return 'React Issues';
  if (ruleId.includes('typescript')) return 'TypeScript Issues';
  return 'Style Issues';
}

function categorizeRustWarning(message) {
  if (message.includes('unused')) return 'Unused Code';
  if (message.includes('never used')) return 'Dead Code';
  if (message.includes('mutable') || message.includes('mut')) return 'Mutability Issues';
  if (message.includes('lifetime')) return 'Lifetime Issues';
  if (message.includes('trait')) return 'Trait Issues';
  return 'Other Warnings';
}

function main() {
  console.log(`${colors.bold}🔍 Error Summary Report${colors.reset}`);
  console.log('=' .repeat(50));
  
  const tsResults = summarizeTypeScriptErrors();
  const eslintResults = summarizeESLintErrors();
  const rustResults = summarizeRustErrors();
  
  console.log(`\n${colors.bold}📊 Overall Summary:${colors.reset}`);
  console.log('=' .repeat(50));
  
  const totalErrors = tsResults.errors + eslintResults.errors + rustResults.errors;
  const totalWarnings = tsResults.warnings + eslintResults.warnings + rustResults.warnings;
  
  console.log(`${colors.red}Total Errors: ${totalErrors}${colors.reset}`);
  console.log(`${colors.yellow}Total Warnings: ${totalWarnings}${colors.reset}`);
  
  if (totalErrors > 0) {
    console.log(`\n${colors.red}❌ Build will fail due to errors${colors.reset}`);
  } else if (totalWarnings > 50) {
    console.log(`\n${colors.yellow}⚠️  High number of warnings - consider cleanup${colors.reset}`);
  } else {
    console.log(`\n${colors.green}✅ No critical issues${colors.reset}`);
  }
  
  // Save detailed report
  const report = {
    timestamp: new Date().toISOString(),
    summary: { errors: totalErrors, warnings: totalWarnings },
    typescript: tsResults,
    eslint: eslintResults,
    rust: rustResults
  };
  
  require('fs').writeFileSync('error-report.json', JSON.stringify(report, null, 2));
  console.log('\nDetailed report saved to error-report.json');
}

main();