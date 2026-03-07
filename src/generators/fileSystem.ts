import { promises as fs } from 'fs';
import path from 'path';

export const createDirectory = async (dirPath: string): Promise<void> => {
  await fs.mkdir(dirPath, { recursive: true });
};

export const readFile = async (filePath: string): Promise<string> => {
  return fs.readFile(filePath, 'utf-8');
};

export const writeFile = async (filePath: string, content: string): Promise<void> => {
  await fs.writeFile(filePath, content, 'utf-8');
};

export const copyTemplateAndInject = async (
  templatePath: string,
  destinationPath: string,
  replacements: Record<string, string>
): Promise<void> => {
  let content = await readFile(templatePath);

  for (const [key, value] of Object.entries(replacements)) {
    // Replace all occurrences of {{KEY}} with the value
    const regex = new RegExp(`{{${key}}}`, 'g');
    content = content.replace(regex, value);
  }

  await writeFile(destinationPath, content);
};
