/**
 * Replaces dynamic variables in snippets and templates:
 * e.g. {{first_name}}, {{name}}, {{company}}
 */
export function interpolateSnippetVariables(
  template: string, 
  variables: { name?: string; company?: string; email?: string }
): string {
  let result = template;
  const fullName = variables.name || variables.email?.split('@')[0] || 'there';
  const firstName = fullName.split(' ')[0];
  const company = variables.company || 'your team';

  result = result.replace(/\{\{\s*first_name\s*\}\}/gi, firstName);
  result = result.replace(/\{\{\s*name\s*\}\}/gi, fullName);
  result = result.replace(/\{\{\s*company\s*\}\}/gi, company);
  return result;
}
