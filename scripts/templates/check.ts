import { checkCatalog } from './catalogFiles.ts';
import { projectRoot } from './project.ts';

const errors = await checkCatalog(projectRoot);
if (errors.length) {
  console.error(
    `Template catalog validation failed with ${errors.length} error${errors.length === 1 ? '' : 's'}:`,
  );
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('Template catalog is valid.');
}
