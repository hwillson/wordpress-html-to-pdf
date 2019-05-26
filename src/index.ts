import https from "https";
import parser from "xml2json";
import fs from "fs";
import pdf from "html-pdf";

interface Config {
  sitemapHost: string;
  sitemapUrl: string;
  saveDirRoot: string;
  fetchUrlParams?: string;
  stripTags?: string[];
  stripContent?: string[];
  filterAndCatalog: Record<string, string>;
}

let Config: Config;

function fetchContent(url: string) {
  return new Promise((resolve, reject) => {
    https
      .get(url, response => {
        let data = "";
        response.on("data", (chunk: string) => {
          data += chunk;
        });
        response.on("end", () => resolve(data));
      })
      .on("error", reject);
  });
}

function getSitemapFiles(sitemapXml: string) {
  const sitemapJson = JSON.parse(parser.toJson(sitemapXml));
  let files: string[] = [];
  if (
    sitemapJson &&
    sitemapJson.sitemapindex &&
    sitemapJson.sitemapindex.sitemap
  ) {
    files = sitemapJson.sitemapindex.sitemap.map((file: any) => file.loc);
  }
  return files;
  // return files.slice(0, 2);
}

function cleanHtml(html: string) {
  let cleanHtml = html;
  if (Config.stripTags) {
    Config.stripTags.forEach(tag => {
      const removeRegexp = new RegExp(`<${tag}.*>[\\S\\s]*?<\/${tag}>`, "ig");
      cleanHtml = cleanHtml.replace(removeRegexp, "");
    });
  }

  if (Config.stripContent) {
    Config.stripContent.forEach(content => {
      cleanHtml = cleanHtml.replace(content, "");
    });
  }
  return cleanHtml;
}

async function fetchAndSaveHtml(
  url: string
): Promise<{ data: string | null; filename: string | null; subdir?: string }> {
  let allowed = false;
  let subdir = "";

  const { filterAndCatalog } = Config;
  if (filterAndCatalog) {
    for (let dir of Object.keys(filterAndCatalog)) {
      const regexp = new RegExp(`(.*)${filterAndCatalog[dir]}(.*)`);
      if (url.match(regexp)) {
        allowed = true;
        subdir = dir;
        break;
      }
    }
  } else {
    allowed = true;
  }

  if (allowed) {
    let newUrl = url;
    if (Config.fetchUrlParams) {
      newUrl += `?${Config.fetchUrlParams}`;
    }
    let data = (await fetchContent(newUrl)) as string;
    data = cleanHtml(data);
    let filename = url
      .replace(Config.sitemapHost, "")
      .replace(/^\//, "")
      .replace(/\/$/, "")
      .replace(/\//g, "-")
      .replace(".html", "");
    filename = filename || "index";
    const saveDir = `${Config.saveDirRoot}/html/${subdir}`;
    fs.writeFileSync(`${saveDir}/${filename}.html`, data);
    return {
      data,
      filename,
      subdir
    };
  } else {
    return {
      data: null,
      filename: null
    };
  }
}

function generatePdf(data: string, filename: string, subdir: string = "") {
  const saveDir = `${Config.saveDirRoot}/pdf/${subdir}`;
  pdf.create(data).toFile(`${saveDir}/${filename}.pdf`, error => {
    if (error) {
      console.error(error);
    }
  });
}

async function saveHtml(files: string[]) {
  for (const file of files) {
    const urlXml = (await fetchContent(file)) as string;
    const urlJson = JSON.parse(parser.toJson(urlXml));
    if (urlJson && urlJson.urlset && urlJson.urlset.url) {
      if (Array.isArray(urlJson.urlset.url)) {
        console.log(
          `Fetching and saving ${urlJson.urlset.url.length} URL's ...`
        );
        const urls = urlJson.urlset.url;
        for (const url of urls) {
          const { data, filename, subdir } = await fetchAndSaveHtml(url.loc);
          if (data && filename) {
            generatePdf(data, filename, subdir);
          }
        }
      } else {
        console.log(`Saving 1 URL ...`);
        const { data, filename, subdir } = await fetchAndSaveHtml(
          urlJson.urlset.url.loc
        );
        if (data && filename) {
          generatePdf(data, filename, subdir);
        }
      }
    }
  }
}

function loadConfig() {
  const configFilePath = process.env.CONFIG_FILE;
  let config: Config;
  if (configFilePath) {
    config = JSON.parse(fs.readFileSync(configFilePath, "utf8"));
  } else {
    throw new Error("Missing config file");
  }
  return config;
}

function createStorageDirectories() {
  const htmlDir = `${Config.saveDirRoot}/html`;
  if (!fs.existsSync(htmlDir)) {
    fs.mkdirSync(htmlDir);
  }

  const pdfDir = `${Config.saveDirRoot}/pdf`;
  if (!fs.existsSync(pdfDir)) {
    fs.mkdirSync(pdfDir);
  }

  const { filterAndCatalog } = Config;
  if (filterAndCatalog) {
    Object.keys(filterAndCatalog).forEach(dir => {
      const fullHtmlDir = `${htmlDir}/${dir}`;
      if (!fs.existsSync(fullHtmlDir)) fs.mkdirSync(fullHtmlDir);

      const fullPdfDir = `${pdfDir}/${dir}`;
      if (!fs.existsSync(fullPdfDir)) fs.mkdirSync(fullPdfDir);
    });
  }
}

(async () => {
  Config = loadConfig();
  console.log("Starting ...");
  console.log("Creating storage directories ...");
  createStorageDirectories();
  console.log("Fetching main sitemap ...");
  const sitemapXml = await fetchContent(Config.sitemapUrl);
  const files = getSitemapFiles(sitemapXml as string);
  console.log(`Building site crawl list from ${files.length} files ...`);
  saveHtml(files);
})();
