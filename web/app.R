#
# This is a Shiny web application. You can run the application by clicking
# the 'Run App' button above.
#
# Find out more about building applications with Shiny here:
#
#    http://shiny.rstudio.com/
#

library(shiny)
library(rredis)
library(stringr)
library(RJSONIO)

redisConnect(host = 'redis', nodelay = FALSE)
clientq <- paste0(
  "client",
  str_match_all(
    redisCmd("CLIENT", "LIST"), "id=(\\d+) .* idle=0 .* cmd=client"
  )[[1]][2]
)

finddocs <- function(query, termw, edgew) {
  if (str_length(query)) {
    #redisLPush("worker", toJSON(c("finddocs", clientq, query))
    # Using redisCmd because LPush seems to put rubbish at start of message
    redisCmd("LPUSH", "worker", toJSON(c("finddocs", clientq, query, termw, edgew)))
    reply <- redisBRPop(clientq, timeout = 60)
    #print(reply)
    return(fromJSON(reply[[clientq]]))
  }
}

loadcoll <- function(coll) {
  print(coll)
  current_coll <- paste0(redisGet("ircoll"), "")
  print(current_coll)
  if ((str_length(coll) > 0) && (coll != current_coll)) {
    redisCmd("LPUSH", "worker", toJSON(c("load", clientq, coll)))
    reply <- redisBRPop(clientq, timeout = 120)
    print(reply)
    redisSet("ircoll", coll)
    return(fromJSON(reply[[clientq]]))
  }
  return(0)
}

# Define UI for application that draws a histogram
ui <- navbarPage("CT5104 The Wikipedia Index", id = "navbar",
  tabPanel("Load",
    uiOutput("ircoll_selection")
  ),
  tabPanel("Query",
    #inputPanel(
    wellPanel(
      #verticalLayout(
        fluidRow(
          column(width = 2, "Query"),
          column(width = 10, textInput("query", NULL, placeholder = "Enter your query"))
        ),
        fluidRow(
          column(width = 2, "Term Weight"),
          column(width = 10, numericInput("termw", NULL, 1.0, min = 0, step = 0.1))
        ),
        fluidRow(
          column(width = 2, "Edge Weight"),
          column(width = 10, numericInput("edgew", NULL, 0.8, min = 0, step = 0.1))
        )
      #)
    ),
    uiOutput("results")
  )
)

# Define server logic required to draw a histogram
server <- function(input, output) {
  output$results <- renderUI({
    start_time <- proc.time()
    results <- finddocs(input$query, input$termw, input$edgew)
    query_time <- proc.time() - start_time
    tagList(
      tags$p(paste(round(query_time[3], digits = 3), "ms")),
      tags$pre(toJSON(results, pretty = TRUE))
    )
  })
  output$ircoll_selection <- renderUI({
    selected <- redisGet("ircoll")
    tagList(
      radioButtons(
        "ircoll", "Document Collection:",
        c(
          "None selected" = "",
          "American Documentation Institute" = "ADI.ALL",
          "Cranfield aeronautics experiments" = "CRAN.ALL",
          "ISI highly cited articles" = "CISI.ALL",
          "Medline" = "MED.ALL"
        ),
        selected = selected
      ),
      actionButton("load", "Load selected")
    )
  })
  observeEvent(input$load, {
    if (str_length(input$ircoll)) {
      withProgress(message = "Loading collection", value = 0, {
        docs <- loadcoll(input$ircoll)
        repeat {
          pages <- redisGet("pages")
          pages <- ifelse(length(pages), as.numeric(pages), 0)
          if (pages >= docs) break
          setProgress(pages/docs, detail = paste0("Enqueued, Processed ", pages, "/", docs))
          Sys.sleep(0.2)
        }
      })
    }
  })
}

# Run the application 
shinyApp(ui = ui, server = server)
